import type { DeploymentJoinedRow, ProjectServiceRow } from '../queries/deployments.query.types';
import { findProjectServiceByName } from '../queries/deployment-context.query';
import {
  findActiveJoinedDeployment,
  listActiveJoinedDeploymentsForEnvironment,
  findJoinedDeploymentByEnvironmentAndId,
  listJoinedDeploymentsForEnvironmentRun,
  listJoinedDeploymentsForService,
} from '../queries/deployment-joined.query';
import {
  createActiveDeploymentNotFoundError,
  createRollbackServiceRequiredError,
  createSourceAndTargetEnvironmentMatchError,
} from '../errors/api-business-error';
import { getApiConfig } from '../runtime/runtime-access';
import {
  listProjectServices,
  requireProjectService,
  resolveExistingEnvironmentContext,
  resolveExistingProjectContext,
} from './deployment-context.service';
import type { ResolvedEnvironmentContext, ResolvedProjectContext } from './deployments.service.types';
import { queueSerializedArtifactDeploymentMovement } from './artifact-deployment-movement.service';
import {
  resolvePromotionEnvironmentContext,
  resolveWritablePromotionEnvironmentContext,
} from './deployment-movement.service.helpers';
import type {
  DeploymentMovementResult,
  DeploymentMovementServiceScope,
  PromoteDeploymentInput,
  RollbackDeploymentInput,
  RollbackDeploymentServiceSelection,
} from './deployment-movement.service.types';
import {
  requirePreviousRollbackCandidate,
  requireRollbackRunActiveServiceCoverage,
  requireReusableArtifactDeployment,
  requireRollbackCandidate,
  requireRollbackScopedDeployment,
  requireRollbackScopedRunDeployments,
} from './deployment-movement.service.rollback.helpers';
import { requireActiveHumanRuntimeActor } from './runtime-actor-authorization.service';

export async function promoteDeploymentsForPrincipal(input: PromoteDeploymentInput): Promise<DeploymentMovementResult> {
  await requireActiveHumanRuntimeActor({
    organizationId: input.organizationId,
    principalId: input.actorPrincipalId,
  });
  if (input.sourceEnvironmentName === input.targetEnvironmentName) {
    throw createSourceAndTargetEnvironmentMatchError();
  }

  const sourceContext: ResolvedEnvironmentContext = await resolvePromotionEnvironmentContext(
    input,
    input.sourceEnvironmentName,
  );
  const sourceDeployments: DeploymentJoinedRow[] = await resolvePromotionSourceDeployments(sourceContext, input);
  const targetContext: ResolvedEnvironmentContext = await resolveWritablePromotionEnvironmentContext(input);

  return await queueSerializedArtifactDeploymentMovement(
    sourceDeployments,
    targetContext.environment,
    input.actorPrincipalId,
    'deployment.promote',
  );
}

export async function rollbackDeploymentForPrincipal(
  input: RollbackDeploymentInput,
): Promise<DeploymentMovementResult> {
  await requireActiveHumanRuntimeActor({
    organizationId: input.organizationId,
    principalId: input.actorPrincipalId,
  });
  const environmentContext: ResolvedEnvironmentContext = await resolveExistingEnvironmentContext(
    input.actorPrincipalId,
    input.organizationSlug,
    input.projectName,
    input.environmentName,
    'deployment.rollback',
  );
  const rollbackTargets: DeploymentJoinedRow[] = await resolveRollbackTargets(environmentContext, input);

  return await queueSerializedArtifactDeploymentMovement(
    rollbackTargets,
    environmentContext.environment,
    input.actorPrincipalId,
    'deployment.rollback',
  );
}

async function resolvePromotionSourceDeployments(
  context: ResolvedEnvironmentContext,
  input: PromoteDeploymentInput,
): Promise<DeploymentJoinedRow[]> {
  if (input.scope.mode === 'service') {
    return [await resolvePromotionSourceDeploymentForService(context, input, input.scope.serviceName)];
  }

  const routeBaseDomain: string = getApiConfig().baseDomain;
  const deployments: DeploymentJoinedRow[] = await listActiveJoinedDeploymentsForEnvironment(
    context.environment.id,
    routeBaseDomain,
  );
  if (deployments.length === 0) {
    throw createActiveDeploymentNotFoundError();
  }

  return deployments.map(requireReusableArtifactDeployment);
}

async function resolvePromotionSourceDeploymentForService(
  context: ResolvedEnvironmentContext,
  input: PromoteDeploymentInput,
  serviceName: string,
): Promise<DeploymentJoinedRow> {
  const projectContext: ResolvedProjectContext = await resolveExistingProjectContext(
    input.actorPrincipalId,
    input.organizationSlug,
    input.projectName,
    context.environment.name,
    serviceName,
    'deployment.promote',
  );
  const deployment: DeploymentJoinedRow | undefined = await findActiveJoinedDeployment(
    context.environment.id,
    projectContext.service.id,
    getApiConfig().baseDomain,
  );

  return requireReusableArtifactDeployment(requireActiveDeployment(deployment));
}

async function resolveRollbackTargets(
  context: ResolvedEnvironmentContext,
  input: RollbackDeploymentInput,
): Promise<DeploymentJoinedRow[]> {
  if (input.target.mode === 'deployment') {
    return [
      await resolveRollbackDeploymentTarget(context, input.target.targetDeploymentId, input.target.serviceSelection),
    ];
  }
  if (input.target.mode === 'run') {
    return await resolveRollbackRunTargets(context, input.target.targetDeploymentRunId);
  }

  return await resolveImplicitRollbackTargets(context, input.target.scope);
}

async function resolveRollbackRunTargets(
  context: ResolvedEnvironmentContext,
  targetDeploymentRunId: string,
): Promise<DeploymentJoinedRow[]> {
  const routeBaseDomain: string = getApiConfig().baseDomain;
  const runDeployments: DeploymentJoinedRow[] = requireRollbackScopedRunDeployments(
    await listJoinedDeploymentsForEnvironmentRun(context.environment.id, targetDeploymentRunId, routeBaseDomain),
    context,
  );
  requireRollbackRunActiveServiceCoverage(
    runDeployments,
    await listActiveJoinedDeploymentsForEnvironment(context.environment.id, routeBaseDomain),
  );

  return runDeployments.map(requireRollbackCandidate);
}

async function resolveImplicitRollbackTargets(
  context: ResolvedEnvironmentContext,
  scope: DeploymentMovementServiceScope,
): Promise<DeploymentJoinedRow[]> {
  if (scope.mode === 'service') {
    const service: ProjectServiceRow = await resolveRequestedRollbackService(context.project.id, scope.serviceName);

    return [await resolveImplicitRollbackTargetForService(context.environment.id, service.id)];
  }

  const routeBaseDomain: string = getApiConfig().baseDomain;
  const activeDeployments: DeploymentJoinedRow[] = await listActiveJoinedDeploymentsForEnvironment(
    context.environment.id,
    routeBaseDomain,
  );
  if (activeDeployments.length === 0) {
    throw createActiveDeploymentNotFoundError();
  }

  return await Promise.all(
    activeDeployments.map(
      async (activeDeployment: DeploymentJoinedRow): Promise<DeploymentJoinedRow> =>
        await resolvePreviousRollbackTarget(context.environment.id, activeDeployment),
    ),
  );
}

async function resolveImplicitRollbackTargetForService(
  environmentId: string,
  projectServiceId: string,
): Promise<DeploymentJoinedRow> {
  const routeBaseDomain: string = getApiConfig().baseDomain;
  const activeDeployment: DeploymentJoinedRow = requireActiveDeployment(
    await findActiveJoinedDeployment(environmentId, projectServiceId, routeBaseDomain),
  );

  return await resolvePreviousRollbackTarget(environmentId, activeDeployment);
}

async function resolvePreviousRollbackTarget(
  environmentId: string,
  activeDeployment: DeploymentJoinedRow,
): Promise<DeploymentJoinedRow> {
  const routeBaseDomain: string = getApiConfig().baseDomain;
  const deployments: DeploymentJoinedRow[] = await listJoinedDeploymentsForService(
    environmentId,
    activeDeployment.service.id,
    routeBaseDomain,
  );

  return requirePreviousRollbackCandidate(activeDeployment, deployments);
}

async function resolveRollbackDeploymentTarget(
  context: ResolvedEnvironmentContext,
  targetDeploymentId: string,
  serviceSelection: RollbackDeploymentServiceSelection,
): Promise<DeploymentJoinedRow> {
  const routeBaseDomain: string = getApiConfig().baseDomain;
  const scopedServiceName: string | undefined = await resolveExplicitRollbackServiceName(
    context.project.id,
    serviceSelection,
  );
  const deployment: DeploymentJoinedRow = requireRollbackScopedDeployment(
    await findJoinedDeploymentByEnvironmentAndId(context.environment.id, targetDeploymentId, routeBaseDomain),
    context,
    scopedServiceName,
  );

  return requireRollbackCandidate(deployment);
}

async function resolveExplicitRollbackServiceName(
  projectId: string,
  serviceSelection: RollbackDeploymentServiceSelection,
): Promise<string | undefined> {
  if (serviceSelection.mode === 'service') {
    await resolveRequestedRollbackService(projectId, serviceSelection.serviceName);

    return serviceSelection.serviceName;
  }

  const services: ProjectServiceRow[] = await listProjectServices(projectId);
  if (services.length > 1) {
    throw createRollbackServiceRequiredError();
  }

  return services[0]?.name;
}

async function resolveRequestedRollbackService(projectId: string, serviceName: string): Promise<ProjectServiceRow> {
  return requireProjectService(await findProjectServiceByName(projectId, serviceName));
}

function requireActiveDeployment(deployment: DeploymentJoinedRow | undefined): DeploymentJoinedRow {
  if (deployment === undefined) {
    throw createActiveDeploymentNotFoundError();
  }

  return deployment;
}
