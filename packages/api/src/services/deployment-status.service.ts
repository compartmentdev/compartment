import type { PermissionKey } from '@compartment/contracts';
import {
  findActiveJoinedDeployment,
  findJoinedDeploymentByEnvironmentAndId,
  findLatestJoinedDeployment,
  listActiveJoinedDeploymentsForEnvironment,
  listJoinedDeploymentsForEnvironment,
} from '../queries/deployment-joined.query';
import type { DeploymentJoinedRow } from '../queries/deployments.query.types';
import { readOrganizationQuotaInfrastructureBlocker } from '../queries/organization-quota-reconciliation.query';
import type { OrganizationQuotaInfrastructureBlockerRow } from '../queries/organization-quota-reconciliation.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import {
  requireEnvironmentScopedDeployment,
  resolveExistingEnvironmentContext,
  resolveExistingProjectContext,
} from './deployment-context.service';
import { readLatestDeploymentsByService, sortDeploymentsByServiceName } from './deployment-selection.service';
import { applyObservedDeploymentPhases } from './deployment-phase.service';
import type {
  DeploymentIdStatusLookupInput,
  DeploymentInfrastructureBlockerResult,
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

  return await buildDeploymentStatusResult(context, [deployment], activeDeployment !== null ? [activeDeployment] : []);
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

  return await buildDeploymentStatusResult(
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

  return await buildDeploymentStatusResult(context, deployments, activeDeployments);
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

async function buildDeploymentStatusResult(
  context: ResolvedEnvironmentContext,
  deployments: DeploymentJoinedRow[],
  activeDeployments: DeploymentJoinedRow[],
): Promise<DeploymentStatusLookupResult> {
  const uniqueDeployments: DeploymentJoinedRow[] = deduplicateDeployments([...deployments, ...activeDeployments]);
  const [observedDeployments, quotaBlocker]: [DeploymentJoinedRow[], OrganizationQuotaInfrastructureBlockerRow | null] =
    await Promise.all([
      applyObservedDeploymentPhases(uniqueDeployments),
      readOrganizationQuotaInfrastructureBlocker(context.organization.id),
    ]);
  const observedById: ReadonlyMap<string, DeploymentJoinedRow> = new Map(
    observedDeployments.map((deployment: DeploymentJoinedRow): [string, DeploymentJoinedRow] => [
      deployment.deployment.id,
      deployment,
    ]),
  );
  return {
    activeDeployments: projectObservedDeployments(activeDeployments, observedById),
    deployments: projectObservedDeployments(deployments, observedById),
    environment: context.environment,
    infrastructureBlocker: buildInfrastructureBlocker(quotaBlocker),
    project: context.project,
  };
}

function buildInfrastructureBlocker(
  row: OrganizationQuotaInfrastructureBlockerRow | null,
): DeploymentInfrastructureBlockerResult | null {
  return row === null
    ? null
    : {
        code: 'organization_quota_reconciliation_failed',
        message: row.message,
        retryAt: row.retryAt,
      };
}

function deduplicateDeployments(deployments: DeploymentJoinedRow[]): DeploymentJoinedRow[] {
  return [
    ...new Map<string, DeploymentJoinedRow>(
      deployments.map((deployment: DeploymentJoinedRow): [string, DeploymentJoinedRow] => [
        deployment.deployment.id,
        deployment,
      ]),
    ).values(),
  ];
}

function projectObservedDeployments(
  deployments: DeploymentJoinedRow[],
  observedById: ReadonlyMap<string, DeploymentJoinedRow>,
): DeploymentJoinedRow[] {
  return deployments.map(
    (deployment: DeploymentJoinedRow): DeploymentJoinedRow => observedById.get(deployment.deployment.id) ?? deployment,
  );
}
