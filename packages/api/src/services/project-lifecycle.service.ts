import type { ProjectLifecycleAction, ProjectLifecycleState } from '@compartment/contracts';
import {
  createProjectLifecycleBusyError,
  createProjectLifecycleNotAvailableError,
  createProjectLifecycleRuntimeStopFailedError,
  createProjectNotDeployedError,
  createProjectNotStartableError,
} from '../errors/api-business-error';
import { findEnvironmentByProjectAndName } from '../queries/deployment-context.query';
import {
  findJoinedDeploymentById,
  listActiveJoinedDeploymentsForEnvironment,
  listJoinedDeploymentsForEnvironment,
} from '../queries/deployment-joined.query';
import { markDeploymentStopped } from '../queries/deployment-lifecycle.query';
import { findDeploymentKubeState } from '../queries/deployment-kube-membership.query';
import type { DeploymentKubeState } from '../queries/deployment-kube-state.types';
import type { DeploymentJoinedRow, DeploymentRow, EnvironmentRow } from '../queries/deployments.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import { resolveActiveProjectScope } from './project-scope.service';
import type { ResolvedProjectScope } from './project-scope.service.types';
import { requireScopedPermission } from './access-scope.service';
import { queueArtifactStartDeployments } from './artifact-deployment-queue.service';
import { readLatestDeploymentsByService } from './deployment-selection.service';
import {
  createProjectStopOperation,
  recordProjectStopOperationFailure,
  recordProjectStopOperationSuccess,
} from './project-lifecycle-operation.service';
import { isReusableStoppedDeployment, readProjectLifecycleState } from './project-lifecycle-state.service';
import type { ProjectLifecycleInput, ProjectLifecycleResult } from './project-lifecycle.service.types';
import { stopKubeProjectDeployment } from './project-lifecycle-kube-stop.service';

interface ProjectLifecycleContext {
  activeDeployments: DeploymentJoinedRow[];
  deployments: DeploymentJoinedRow[];
  environment: EnvironmentRow;
  projectScope: ResolvedProjectScope;
  state: ProjectLifecycleState;
}

interface ProjectLifecycleDeploymentState {
  activeDeployments: DeploymentJoinedRow[];
  deployments: DeploymentJoinedRow[];
}

export async function startProjectForPrincipal(input: ProjectLifecycleInput): Promise<ProjectLifecycleResult> {
  const context: ProjectLifecycleContext = await resolveProjectLifecycleContext(input, 'start');
  if (context.state === 'running') {
    return buildProjectLifecycleResult('start', context, context.activeDeployments, 'running');
  }
  if (context.state === 'updating') {
    throw createProjectLifecycleBusyError();
  }
  if (context.state === 'not_deployed') {
    throw createProjectNotStartableError();
  }
  if (context.state !== 'stopped') {
    throw createProjectLifecycleNotAvailableError();
  }

  const queuedDeployments: DeploymentJoinedRow[] = await queueArtifactStartDeployments(
    requireStartSourceDeployments(context.deployments),
    context.environment,
    input.principalId,
  );

  return buildProjectLifecycleResult('start', context, queuedDeployments, 'updating');
}

export async function stopProjectForPrincipal(input: ProjectLifecycleInput): Promise<ProjectLifecycleResult> {
  const context: ProjectLifecycleContext = await resolveProjectLifecycleContext(input, 'stop');
  if (context.state === 'stopped') {
    return buildProjectLifecycleResult('stop', context, context.deployments, 'stopped');
  }
  if (context.state === 'not_deployed') {
    throw createProjectNotDeployedError();
  }
  if (context.state === 'updating') {
    throw createProjectLifecycleBusyError();
  }
  if (context.state !== 'running') {
    throw createProjectLifecycleNotAvailableError();
  }

  const stoppedDeployments: DeploymentJoinedRow[] = await stopActiveProjectDeployments(
    context.activeDeployments,
    input.principalId,
    context.projectScope.project.name,
    context.environment,
  );

  return buildProjectLifecycleResult('stop', context, stoppedDeployments, 'stopped');
}

async function resolveProjectLifecycleContext(
  input: ProjectLifecycleInput,
  action: ProjectLifecycleAction,
): Promise<ProjectLifecycleContext> {
  const projectScope: ResolvedProjectScope = await resolveLifecycleProjectScope(input);
  const environment: EnvironmentRow = await resolveAuthorizedLifecycleEnvironment(input, projectScope, action);
  const deploymentState: ProjectLifecycleDeploymentState = await readProjectLifecycleDeploymentState(environment.id);

  return {
    activeDeployments: deploymentState.activeDeployments,
    deployments: deploymentState.deployments,
    environment,
    projectScope,
    state: readProjectLifecycleState(deploymentState.deployments, deploymentState.activeDeployments),
  };
}

async function resolveLifecycleProjectScope(input: ProjectLifecycleInput): Promise<ResolvedProjectScope> {
  return await resolveActiveProjectScope(input.principalId, input.organizationSlug, input.projectName);
}

async function resolveAuthorizedLifecycleEnvironment(
  input: ProjectLifecycleInput,
  projectScope: ResolvedProjectScope,
  action: ProjectLifecycleAction,
): Promise<EnvironmentRow> {
  const environment: EnvironmentRow = await requireProjectLifecycleEnvironment(
    projectScope.project.id,
    input.environmentName,
    action,
  );
  await requireScopedPermission({
    organizationId: projectScope.organization.id,
    permission: 'project.lifecycle.write',
    principalId: input.principalId,
    routeScope: {
      scopeId: environment.id,
      scopeType: 'environment',
    },
  });

  return environment;
}

async function readProjectLifecycleDeploymentState(environmentId: string): Promise<ProjectLifecycleDeploymentState> {
  const routeBaseDomain: string = getApiConfig().baseDomain;

  return {
    activeDeployments: await listActiveJoinedDeploymentsForEnvironment(environmentId, routeBaseDomain),
    deployments: readLatestDeploymentsByService(
      await listJoinedDeploymentsForEnvironment(environmentId, routeBaseDomain),
    ),
  };
}

async function requireProjectLifecycleEnvironment(
  projectId: string,
  environmentName: string,
  action: ProjectLifecycleAction,
): Promise<EnvironmentRow> {
  const environment: EnvironmentRow | undefined = await findEnvironmentByProjectAndName(projectId, environmentName);
  if (environment !== undefined) {
    return environment;
  }

  throw action === 'start' ? createProjectNotStartableError() : createProjectNotDeployedError();
}

async function stopActiveProjectDeployments(
  deployments: DeploymentJoinedRow[],
  actorPrincipalId: string,
  projectName: string,
  environment: EnvironmentRow,
): Promise<DeploymentJoinedRow[]> {
  const updatedAt: Date = new Date();
  const operationId: string = await createProjectStopOperation(actorPrincipalId, projectName, environment);
  const stopResults: PromiseSettledResult<DeploymentJoinedRow>[] = await Promise.allSettled(
    deployments.map(
      async (deployment: DeploymentJoinedRow): Promise<DeploymentJoinedRow> =>
        await stopActiveProjectDeployment(deployment, updatedAt),
    ),
  );

  if (hasRejectedStopResult(stopResults)) {
    await recordProjectStopOperationFailure(operationId, projectName, environment, updatedAt);
    throw createProjectLifecycleRuntimeStopFailedError();
  }

  await recordProjectStopOperationSuccess(operationId, projectName, environment, updatedAt);

  return readFulfilledStopDeployments(stopResults);
}

async function stopActiveProjectDeployment(
  deployment: DeploymentJoinedRow,
  updatedAt: Date,
): Promise<DeploymentJoinedRow> {
  const routeBaseDomain: string = getApiConfig().baseDomain;
  const kubeState: DeploymentKubeState | undefined = await findDeploymentKubeState(deployment.deployment.id);

  try {
    if (kubeState === undefined) {
      throw createProjectLifecycleRuntimeStopFailedError();
    }
    await stopKubeProjectDeployment(deployment.deployment.id, kubeState, updatedAt);
  } catch {
    throw createProjectLifecycleRuntimeStopFailedError();
  }

  const stoppedDeployment: DeploymentRow = await markDeploymentStopped({
    deploymentId: deployment.deployment.id,
    updatedAt,
  });

  return requireJoinedDeployment(await findJoinedDeploymentById(stoppedDeployment.id, routeBaseDomain));
}

function hasRejectedStopResult(results: PromiseSettledResult<DeploymentJoinedRow>[]): boolean {
  return results.some((result: PromiseSettledResult<DeploymentJoinedRow>): boolean => result.status === 'rejected');
}

function readFulfilledStopDeployments(results: PromiseSettledResult<DeploymentJoinedRow>[]): DeploymentJoinedRow[] {
  return results
    .filter(
      (result: PromiseSettledResult<DeploymentJoinedRow>): result is PromiseFulfilledResult<DeploymentJoinedRow> =>
        result.status === 'fulfilled',
    )
    .map((result: PromiseFulfilledResult<DeploymentJoinedRow>): DeploymentJoinedRow => result.value);
}

function requireStartSourceDeployments(deployments: DeploymentJoinedRow[]): DeploymentJoinedRow[] {
  if (deployments.length === 0 || !deployments.every(isReusableStoppedDeployment)) {
    throw createProjectNotStartableError();
  }

  return deployments;
}

function buildProjectLifecycleResult(
  action: ProjectLifecycleAction,
  context: ProjectLifecycleContext,
  deployments: DeploymentJoinedRow[],
  state: ProjectLifecycleState,
): ProjectLifecycleResult {
  return {
    action,
    deployments,
    environment: context.environment,
    project: context.projectScope.project,
    state,
  };
}

function requireJoinedDeployment(deployment: DeploymentJoinedRow | undefined): DeploymentJoinedRow {
  if (deployment === undefined) {
    throw new Error('Expected stopped deployment to be readable.');
  }

  return deployment;
}
