import type { PermissionKey } from '@compartment/contracts';
import {
  findActiveJoinedDeployment,
  findJoinedDeploymentByEnvironmentAndId,
  findLatestJoinedDeployment,
  listActiveJoinedDeploymentsForEnvironment,
  listJoinedDeploymentsForEnvironment,
} from '../queries/deployment-joined.query';
import type { DeploymentJoinedRow } from '../queries/deployments.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import {
  requireEnvironmentScopedDeployment,
  resolveExistingEnvironmentContext,
  resolveExistingProjectContext,
} from './deployment-context.service';
import { readLatestDeploymentsByService, sortDeploymentsByServiceName } from './deployment-selection.service';
import type {
  DeploymentIdStatusLookupInput,
  DeploymentStatusLookupResult,
  ResolvedEnvironmentContext,
  ResolvedProjectContext,
  ServiceStatusLookupInput,
  StatusLookupInput,
} from './deployments.service.types';

export async function getDeploymentStatusSummary(
  input: StatusLookupInput,
  permission: PermissionKey = 'deployment.read',
): Promise<DeploymentStatusLookupResult> {
  const environmentContext: ResolvedEnvironmentContext = await resolveExistingEnvironmentContext(
    input.principalId,
    input.organizationSlug,
    input.projectName,
    input.environmentName,
    permission,
  );
  if (input.mode === 'deployment') {
    return await resolveDeploymentStatusById(environmentContext, input);
  }
  if (input.mode === 'service') {
    return await resolveScopedDeploymentStatus(environmentContext, input, permission);
  }

  return await resolveEnvironmentDeploymentStatus(environmentContext);
}

async function resolveDeploymentStatusById(
  context: ResolvedEnvironmentContext,
  input: DeploymentIdStatusLookupInput,
): Promise<DeploymentStatusLookupResult> {
  const deployment: DeploymentJoinedRow = requireEnvironmentScopedDeployment(
    await findJoinedDeploymentByEnvironmentAndId(context.environment.id, input.deploymentId, getApiConfig().baseDomain),
    context,
    input.serviceName,
  );
  const activeDeployment: DeploymentJoinedRow | null = await resolveActiveDeploymentForService(
    context.environment.id,
    deployment.service.id,
    deployment,
  );

  return buildDeploymentStatusResult(context, [deployment], activeDeployment !== null ? [activeDeployment] : []);
}

async function resolveScopedDeploymentStatus(
  context: ResolvedEnvironmentContext,
  input: ServiceStatusLookupInput,
  permission: PermissionKey,
): Promise<DeploymentStatusLookupResult> {
  const projectContext: ResolvedProjectContext = await resolveScopedStatusProjectContext(context, input, permission);
  const deployment: DeploymentJoinedRow | null = await readLatestScopedDeployment(
    context.environment.id,
    projectContext.service.id,
  );
  const activeDeployment: DeploymentJoinedRow | null = await resolveActiveDeploymentForService(
    context.environment.id,
    projectContext.service.id,
    deployment,
  );

  return buildDeploymentStatusResult(
    context,
    deployment !== null ? [deployment] : [],
    activeDeployment !== null ? [activeDeployment] : [],
  );
}

async function resolveScopedStatusProjectContext(
  context: ResolvedEnvironmentContext,
  input: ServiceStatusLookupInput,
  permission: PermissionKey,
): Promise<ResolvedProjectContext> {
  return await resolveExistingProjectContext(
    input.principalId,
    input.organizationSlug,
    input.projectName,
    context.environment.name,
    input.serviceName,
    permission,
  );
}

async function readLatestScopedDeployment(
  environmentId: string,
  projectServiceId: string,
): Promise<DeploymentJoinedRow | null> {
  return (await findLatestJoinedDeployment(environmentId, projectServiceId, getApiConfig().baseDomain)) ?? null;
}

async function resolveEnvironmentDeploymentStatus(
  context: ResolvedEnvironmentContext,
): Promise<DeploymentStatusLookupResult> {
  const deployments: DeploymentJoinedRow[] = readLatestDeploymentsByService(
    await listJoinedDeploymentsForEnvironment(context.environment.id, getApiConfig().baseDomain),
  );
  const activeDeployments: DeploymentJoinedRow[] = sortDeploymentsByServiceName(
    await listActiveJoinedDeploymentsForEnvironment(context.environment.id, getApiConfig().baseDomain),
  );

  return buildDeploymentStatusResult(context, deployments, activeDeployments);
}

async function resolveActiveDeploymentForService(
  environmentId: string,
  projectServiceId: string,
  deployment: DeploymentJoinedRow | null,
): Promise<DeploymentJoinedRow | null> {
  if (deployment?.deployment.isActive === true) {
    return deployment;
  }

  return (await findActiveJoinedDeployment(environmentId, projectServiceId, getApiConfig().baseDomain)) ?? null;
}

function buildDeploymentStatusResult(
  context: ResolvedEnvironmentContext,
  deployments: DeploymentJoinedRow[],
  activeDeployments: DeploymentJoinedRow[],
): DeploymentStatusLookupResult {
  return {
    activeDeployments,
    deployments,
    environment: context.environment,
    project: context.project,
  };
}
