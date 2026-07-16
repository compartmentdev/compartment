import type { DeploymentLogLine } from '@compartment/contracts';
import { createActiveDeploymentNotFoundError } from '../errors/api-business-error';
import { listDeploymentRuntimeEvents } from '../queries/deployment-runtime-events.query';
import type { DeploymentRuntimeEventRow } from '../queries/deployment-runtime-events.query.types';
import {
  findActiveJoinedDeployment,
  listActiveJoinedDeploymentsForEnvironment,
} from '../queries/deployment-joined.query';
import { findProjectServiceByName } from '../queries/deployment-context.query';
import type { DeploymentJoinedRow, ProjectServiceRow } from '../queries/deployments.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import {
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
import { collectReleaseJobLogLines } from './release-job-logs.service';

export async function getDeploymentLogsForEnvironment(
  input: DeploymentLogsLookupInput,
): Promise<DeploymentLogsLookupResult> {
  const context: DeploymentLogsContext = await resolveDeploymentLogsContext(input);
  const sinceDate: Date | undefined = parseLogsSince(input.since);
  const lines: DeploymentLogLine[] = await collectDeploymentLogs(
    context.deployments,
    context.environment.name,
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
  sinceDate: Date | undefined,
  tailLines: number | undefined,
): Promise<DeploymentLogLine[]> {
  const logLineGroups: DeploymentLogLine[][] = await Promise.all([
    collectReleaseJobLogLines(activeDeployments, environmentName, sinceDate),
    resolveCompartmentEventLines(activeDeployments, environmentName, sinceDate),
    readStoredDeploymentProductLogs(activeDeployments, environmentName, sinceDate, tailLines),
  ]);

  return trimMergedDeploymentLines(logLineGroups.flat().sort(compareDeploymentLogLinesByTimestamp), tailLines);
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
