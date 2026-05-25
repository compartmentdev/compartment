import { createDeploymentNotFoundError, isApiBusinessError } from '../errors/api-business-error';
import { listDeploymentRunEvents } from '../queries/deployment-run-events.query';
import type { DeploymentRunEventRow } from '../queries/deployment-run-events.query.types';
import { findProjectServiceByName } from '../queries/deployment-context.query';
import { listJoinedDeploymentsForEnvironmentRun } from '../queries/deployment-joined.query';
import type { DeploymentJoinedRow, ProjectServiceRow } from '../queries/deployments.query.types';
import { findDeploymentRunByProject, findLatestDeploymentRunForEnvironment } from '../queries/deployment-runs.query';
import type { DeploymentRunRow } from '../queries/deployment-runs.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import {
  requireProjectService,
  resolveEnvironmentName,
  resolveExistingEnvironmentContext,
  resolveExistingProjectLookupContext,
} from './deployment-context.service';
import { requireScopedPermission } from './access-scope.service';
import {
  buildDeploymentRunLineEvents,
  buildScopedDeploymentRunEventsForLogs,
} from './deployment-run-log-events.service';
import type {
  DeploymentRunLogsLookupInput,
  ResolvedEnvironmentContext,
  ResolvedProjectLookupContext,
} from './deployments.service.types';
import { parseLogsSince } from './deployment-log-query.service';
import type { DeploymentRunLogsResponseInput } from './presenter.types';

type DeploymentRunLogsDeployments = [DeploymentJoinedRow, ...DeploymentJoinedRow[]];

interface ResolvedRunDeployments {
  runDeployments: DeploymentRunLogsDeployments;
  scopedDeployments: DeploymentRunLogsDeployments;
}

export async function getDeploymentRunLogs(
  input: DeploymentRunLogsLookupInput,
): Promise<DeploymentRunLogsResponseInput> {
  if (input.selector === 'latest') {
    return await getLatestDeploymentRunLogs(input);
  }

  return await getDeploymentRunLogsById(input, input.deploymentRunId);
}

async function getLatestDeploymentRunLogs(
  input: DeploymentRunLogsLookupInput,
): Promise<DeploymentRunLogsResponseInput> {
  const environmentContext: ResolvedEnvironmentContext = await resolveExistingEnvironmentContext(
    input.principalId,
    input.organizationSlug,
    input.projectName,
    resolveEnvironmentName(input.environmentName),
    'deployment.logs.read',
  );
  const service: ProjectServiceRow | undefined = await readScopedProjectService(
    environmentContext.project.id,
    input.serviceName,
  );
  const run: DeploymentRunRow | undefined = await findLatestDeploymentRunForEnvironment(
    environmentContext.environment.id,
    service?.id,
  );
  if (run === undefined) {
    throw createDeploymentNotFoundError();
  }

  const deployments: ResolvedRunDeployments = await resolveRunDeployments(run, input.serviceName);
  return await buildDeploymentRunLogsLookupResult(run, deployments, input);
}

async function getDeploymentRunLogsById(
  input: DeploymentRunLogsLookupInput,
  deploymentRunId: string,
): Promise<DeploymentRunLogsResponseInput> {
  const projectContext: ResolvedProjectLookupContext = await resolveExistingProjectLookupContext(
    input.principalId,
    input.organizationSlug,
    input.projectName,
  );
  const run: DeploymentRunRow | undefined = await findDeploymentRunByProject({
    deploymentRunId,
    environmentName: input.environmentName,
    projectId: projectContext.project.id,
  });
  if (run === undefined) {
    throw createDeploymentNotFoundError();
  }

  const deployments: ResolvedRunDeployments = await resolveRunDeployments(run, input.serviceName);
  const [firstDeployment] = deployments.scopedDeployments;
  if (firstDeployment.project.id !== projectContext.project.id) {
    throw createDeploymentNotFoundError();
  }
  await requireDeploymentRunLogsPermissionOrHide(projectContext, input.principalId, firstDeployment.environment.id);

  return await buildDeploymentRunLogsLookupResult(run, deployments, input);
}

async function requireDeploymentRunLogsPermissionOrHide(
  context: ResolvedProjectLookupContext,
  principalId: string,
  environmentId: string,
): Promise<void> {
  try {
    await requireDeploymentRunLogsPermission(context, principalId, environmentId);
  } catch (error) {
    if (error instanceof Error && isForbiddenError(error)) {
      throw createDeploymentNotFoundError();
    }

    throw error;
  }
}

async function requireDeploymentRunLogsPermission(
  context: ResolvedProjectLookupContext,
  principalId: string,
  environmentId: string,
): Promise<void> {
  await requireScopedPermission({
    organizationId: context.organization.id,
    permission: 'deployment.logs.read',
    principalId,
    routeScope: {
      scopeId: environmentId,
      scopeType: 'environment',
    },
  });
}

function isForbiddenError(error: Error): boolean {
  return isApiBusinessError(error) && error.code === 'forbidden';
}

async function buildDeploymentRunLogsLookupResult(
  run: DeploymentRunRow,
  deployments: ResolvedRunDeployments,
  input: DeploymentRunLogsLookupInput,
): Promise<DeploymentRunLogsResponseInput> {
  const since: Date | undefined = parseLogsSince(input.since);
  const [firstDeployment] = deployments.scopedDeployments;
  const events: DeploymentRunEventRow[] = await readScopedDeploymentRunEvents(run.id, deployments.scopedDeployments);

  return {
    deployments: deployments.scopedDeployments,
    environmentName: firstDeployment.environment.name,
    lineEvents: buildDeploymentRunLineEvents(events, since, input.tailLines),
    projectName: firstDeployment.project.name,
    run,
    runDeployments: deployments.runDeployments,
    stepEvents: events,
  };
}

async function readScopedProjectService(
  projectId: string,
  serviceName: string | undefined,
): Promise<ProjectServiceRow | undefined> {
  return serviceName === undefined
    ? undefined
    : requireProjectService(await findProjectServiceByName(projectId, serviceName));
}

async function resolveRunDeployments(
  run: DeploymentRunRow,
  serviceName: string | undefined,
): Promise<ResolvedRunDeployments> {
  const runDeployments: DeploymentRunLogsDeployments = requireDeploymentRunLogsDeployments(
    await listJoinedDeploymentsForEnvironmentRun(run.environmentId, run.id, getApiConfig().baseDomain),
  );
  const scopedDeployments: DeploymentJoinedRow[] =
    serviceName === undefined
      ? runDeployments
      : runDeployments.filter((deployment: DeploymentJoinedRow): boolean => deployment.service.name === serviceName);

  return {
    runDeployments,
    scopedDeployments: requireDeploymentRunLogsDeployments(scopedDeployments),
  };
}

async function readScopedDeploymentRunEvents(
  deploymentRunId: string,
  deployments: DeploymentRunLogsDeployments,
): Promise<DeploymentRunEventRow[]> {
  return buildScopedDeploymentRunEventsForLogs(
    await listDeploymentRunEvents(deploymentRunId),
    new Set<string>(deployments.map((deployment: DeploymentJoinedRow): string => deployment.deployment.id)),
  );
}

function requireDeploymentRunLogsDeployments(deployments: DeploymentJoinedRow[]): DeploymentRunLogsDeployments {
  const [firstDeployment, ...otherDeployments] = deployments;
  if (firstDeployment === undefined) {
    throw createDeploymentNotFoundError();
  }

  return [firstDeployment, ...otherDeployments];
}
