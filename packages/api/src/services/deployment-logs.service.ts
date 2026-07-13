import type { DeploymentLogLine, NodeTailLogsQuery, NodeTailLogsResponse } from '@compartment/contracts';
import { tailNodeDeploymentLogs } from '@compartment/sdk';
import { createActiveDeploymentNotFoundError } from '../errors/api-business-error';
import { findNodeById } from '../queries/node.query';
import { listDeploymentRuntimeEvents } from '../queries/deployment-runtime-events.query';
import type { DeploymentRuntimeEventRow } from '../queries/deployment-runtime-events.query.types';
import {
  findActiveJoinedDeployment,
  listActiveJoinedDeploymentsForEnvironment,
} from '../queries/deployment-joined.query';
import { findProjectServiceByName } from '../queries/deployment-context.query';
import type { DeploymentJoinedRow, ProjectServiceRow } from '../queries/deployments.query.types';
import type { NodeRow } from '../queries/node.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import {
  requireContainerId,
  requireNode,
  requireProjectService,
  resolveEnvironmentName,
  resolveExistingEnvironmentContext,
} from './deployment-context.service';
import type {
  DeploymentLogsContext,
  DeploymentLogsLookupInput,
  DeploymentLogsLookupResult,
  ResolvedEnvironmentContext,
} from './deployments.service.types';
import { parseLogsSince } from './deployment-log-query.service';
import { readStoredDeploymentProductLogs } from './deployment-product-logs.service';
import { listKubeDeploymentIds } from '../queries/deployment-log-workload.query';
import { createNodeRuntimeRequester } from './node-runtime-requester';

export async function getDeploymentLogsForEnvironment(
  input: DeploymentLogsLookupInput,
): Promise<DeploymentLogsLookupResult> {
  const context: DeploymentLogsContext = await resolveDeploymentLogsContext(input);
  const sinceDate: Date | undefined = parseLogsSince(input.since);
  const lines: DeploymentLogLine[] = await collectDeploymentLogs(
    context.deployments,
    context.environment.name,
    input.since,
    sinceDate,
    input.tailLines,
  );

  return {
    deployments: context.deployments,
    environment: context.environment,
    lines,
    project: context.project,
  };
}

async function collectDeploymentLogs(
  activeDeployments: DeploymentJoinedRow[],
  environmentName: string,
  since: string | undefined,
  sinceDate: Date | undefined,
  tailLines: number | undefined,
): Promise<DeploymentLogLine[]> {
  const logLineGroups: DeploymentLogLine[][] = await Promise.all([
    collectNodeDeploymentLogLines(activeDeployments, environmentName, since, tailLines),
    resolveCompartmentEventLines(activeDeployments, environmentName, sinceDate),
    readStoredDeploymentProductLogs(activeDeployments, environmentName, sinceDate, tailLines),
  ]);

  return trimMergedDeploymentLines(logLineGroups.flat().sort(compareDeploymentLogLinesByTimestamp), tailLines);
}

async function collectNodeDeploymentLogLines(
  deployments: DeploymentJoinedRow[],
  environmentName: string,
  since: string | undefined,
  tailLines: number | undefined,
): Promise<DeploymentLogLine[]> {
  return await collectNodeLogLines(await selectNodeDeployments(deployments), environmentName, since, tailLines);
}

async function selectNodeDeployments(deployments: DeploymentJoinedRow[]): Promise<DeploymentJoinedRow[]> {
  const ids: string[] = deployments.map((deployment: DeploymentJoinedRow): string => deployment.deployment.id);
  const kubeDeploymentIds: Set<string> = new Set<string>(await listKubeDeploymentIds(ids));
  return deployments.filter(
    (deployment: DeploymentJoinedRow): boolean => !kubeDeploymentIds.has(deployment.deployment.id),
  );
}

async function collectNodeLogLines(
  deployments: DeploymentJoinedRow[],
  environmentName: string,
  since: string | undefined,
  tailLines: number | undefined,
): Promise<DeploymentLogLine[]> {
  const groups: DeploymentLogLine[][] = await Promise.all(
    deployments.map(
      async (deployment: DeploymentJoinedRow): Promise<DeploymentLogLine[]> =>
        await resolveNodeLogLines(deployment, environmentName, since, tailLines),
    ),
  );
  return groups.flat();
}

async function resolveNodeLogLines(
  deployment: DeploymentJoinedRow,
  environmentName: string,
  since: string | undefined,
  tailLines: number | undefined,
): Promise<DeploymentLogLine[]> {
  const node: NodeRow = requireNode(await findNodeById(deployment.deployment.nodeId));
  const containerId: string = requireContainerId(deployment);
  const query: NodeTailLogsQuery = {
    containerId,
    deploymentId: deployment.deployment.id,
    environmentName,
    serviceName: deployment.service.name,
    since,
    tailLines,
  };
  const response: NodeTailLogsResponse = await tailNodeDeploymentLogs(
    createNodeRuntimeRequester(node.nodeSocketPath),
    query,
  );

  return response.lines;
}

async function resolveCompartmentEventLines(
  activeDeployments: DeploymentJoinedRow[],
  environmentName: string,
  sinceDate: Date | undefined,
): Promise<DeploymentLogLine[]> {
  const deploymentById: Map<string, DeploymentJoinedRow> = buildDeploymentMap(activeDeployments);
  const runtimeEvents: DeploymentRuntimeEventRow[] = await listDeploymentRuntimeEvents(
    [...deploymentById.keys()],
    sinceDate,
  );

  return runtimeEvents.flatMap((runtimeEvent: DeploymentRuntimeEventRow): DeploymentLogLine[] => {
    const deployment: DeploymentJoinedRow | undefined = deploymentById.get(runtimeEvent.deploymentId);
    if (deployment === undefined) {
      return [];
    }

    return [buildCompartmentEventLine(runtimeEvent, deployment, environmentName)];
  });
}

function buildDeploymentMap(activeDeployments: DeploymentJoinedRow[]): Map<string, DeploymentJoinedRow> {
  return new Map<string, DeploymentJoinedRow>(
    activeDeployments.map((deployment: DeploymentJoinedRow): [string, DeploymentJoinedRow] => [
      deployment.deployment.id,
      deployment,
    ]),
  );
}

function buildCompartmentEventLine(
  runtimeEvent: DeploymentRuntimeEventRow,
  deployment: DeploymentJoinedRow,
  environmentName: string,
): DeploymentLogLine {
  return {
    deploymentId: runtimeEvent.deploymentId,
    environmentName,
    message: runtimeEvent.message,
    serviceName: deployment.service.name,
    stream: runtimeEvent.stream,
    timestamp: runtimeEvent.createdAt.toISOString(),
  };
}

function trimMergedDeploymentLines(lines: DeploymentLogLine[], tailLines: number | undefined): DeploymentLogLine[] {
  if (tailLines === undefined || lines.length <= tailLines) {
    return lines;
  }

  return lines.slice(-tailLines);
}

function compareDeploymentLogLinesByTimestamp(left: DeploymentLogLine, right: DeploymentLogLine): number {
  const leftTime: number = Date.parse(left.timestamp);
  const rightTime: number = Date.parse(right.timestamp);
  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
    return left.timestamp.localeCompare(right.timestamp);
  }

  return leftTime - rightTime;
}

async function resolveDeploymentLogsContext(input: DeploymentLogsLookupInput): Promise<DeploymentLogsContext> {
  const context: ResolvedEnvironmentContext = await resolveExistingEnvironmentContext(
    input.principalId,
    input.organizationSlug,
    input.projectName,
    resolveEnvironmentName(input.environmentName),
    'deployment.logs.read',
  );
  const activeDeployments: DeploymentJoinedRow[] = await resolveActiveDeploymentsForLogs(context, input.serviceName);
  if (activeDeployments.length === 0) {
    throw createActiveDeploymentNotFoundError();
  }

  return {
    deployments: activeDeployments,
    environment: context.environment,
    project: context.project,
  };
}

async function resolveActiveDeploymentsForLogs(
  context: ResolvedEnvironmentContext,
  serviceName: string | undefined,
): Promise<DeploymentJoinedRow[]> {
  if (serviceName !== undefined) {
    return await resolveScopedActiveDeployments(context, serviceName);
  }

  const routeBaseDomain: string = getApiConfig().baseDomain;

  return await listActiveJoinedDeploymentsForEnvironment(context.environment.id, routeBaseDomain);
}

async function resolveScopedActiveDeployments(
  context: ResolvedEnvironmentContext,
  serviceName: string,
): Promise<DeploymentJoinedRow[]> {
  const service: ProjectServiceRow = requireProjectService(
    await findProjectServiceByName(context.project.id, serviceName),
  );
  const routeBaseDomain: string = getApiConfig().baseDomain;
  const activeDeployment: DeploymentJoinedRow | undefined = await findActiveJoinedDeployment(
    context.environment.id,
    service.id,
    routeBaseDomain,
  );

  return activeDeployment !== undefined ? [activeDeployment] : [];
}
