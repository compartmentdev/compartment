import { defaultCompartmentEnvironmentName } from '@compartment/contracts';
import { hasText } from '@compartment/utils';
import { readApiPublicIngressConfig, type ApiConfig } from '../config';
import { createActiveDeploymentNotFoundError } from '../errors/api-business-error';
import { createId } from '../lib/tokens';
import { listCustomDomains as listCustomDomainRows } from '../queries/custom-domains.query';
import { beginCustomDomainDeletion, markCustomDomainDeletionReady } from '../queries/custom-domain-deletion.query';
import type { CustomDomainDeletionTransition } from '../queries/custom-domain-reconcile.query.types';
import type { CustomDomainRow } from '../queries/custom-domains.query.types';
import { findActiveDeploymentRouteByOwner } from '../queries/deployment-routes.query';
import type { DeploymentRouteLookupRow } from '../queries/deployment-routes.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import type { EnvironmentRow, ProjectServiceRow } from '../queries/deployments.query.types';
import type { OrganizationRow } from '../queries/organizations.query.types';
import {
  resolveActiveProjectScope,
  resolveExistingEnvironment,
  resolveRequiredOrganization,
  resolveRequiredProjectService,
} from './project-scope.service';
import type { ResolvedProjectScope } from './project-scope.service.types';
import { readRuntimeDomainHostPlan } from './system-domain-runtime.service';
import { persistCustomDomainVerificationResult } from './custom-domain-edge-state.service';
import { synchronizeEdgeAppAccessState } from './app-access-edge.service';
import { verifyCustomDomainDns } from './custom-domain-dns.service';
import type { CustomDomainDnsVerificationResult } from './custom-domain-dns.service.types';
import {
  readCanonicalRouteHost,
  readCustomDomainResult,
  requireCustomDomainForOrganization,
  toCustomDomainServiceDomain,
} from './custom-domain-reader.service';
import {
  buildCustomDomainDnsConfig,
  requireCustomDomainPermission,
  requireOrganizationPermission,
  requireVisibleCustomDomainPermission,
} from './custom-domain.service.helpers';
import {
  insertCustomDomainForTarget,
  throwIfCustomDomainAssigned,
  type CustomDomainInsertTarget,
  type PendingCustomDomainInsert,
} from './custom-domain-registration.service';
import type {
  AddCustomDomainInput,
  CustomDomainHostInput,
  CustomDomainListResult,
  CustomDomainServiceDomain,
  CustomDomainServiceResult,
  ListCustomDomainsInput,
  RemovedCustomDomainResult,
} from './custom-domain.service.types';
import { assertRuntimeSupportsCustomDomains, normalizeCustomDomainHost } from './custom-domain-validation.service';

interface ResolvedCustomDomainTarget {
  environment: EnvironmentRow;
  organizationId: string;
  service: ProjectServiceRow;
}

interface ResolvedCustomDomainTargetScope {
  environment: EnvironmentRow;
  organizationId: string;
  service: ProjectServiceRow;
}

export async function addCustomDomain(input: AddCustomDomainInput): Promise<CustomDomainServiceResult> {
  const config: ApiConfig = getApiConfig();
  const host: string = normalizeCustomDomainHost(input.host, config);
  const target: ResolvedCustomDomainTarget = await resolveCustomDomainTarget(input, config);
  const pendingDomain: PendingCustomDomainInsert = {
    createdByPrincipalId: input.principalId,
    domainId: createId('cdom'),
    host,
    now: new Date(),
  };
  await throwIfCustomDomainAssigned(host);
  await insertCustomDomainForTarget(toCustomDomainInsertTarget(target), pendingDomain, config);

  return await readCustomDomainResult(target.organizationId, host, config);
}

function toCustomDomainInsertTarget(target: ResolvedCustomDomainTarget): CustomDomainInsertTarget {
  return {
    environmentId: target.environment.id,
    organizationId: target.organizationId,
    serviceId: target.service.id,
  };
}

export async function listCustomDomains(input: ListCustomDomainsInput): Promise<CustomDomainListResult> {
  const organizationId: string = await resolveCustomDomainListOrganizationId(input);
  const rows: CustomDomainRow[] = await listCustomDomainRows({
    environmentName: input.environmentName,
    organizationId,
    projectName: hasText(input.projectName) ? input.projectName : undefined,
    serviceName: input.serviceName,
  });
  const config: ApiConfig = getApiConfig();
  const domains: CustomDomainServiceDomain[] = [];
  for (const row of rows) {
    domains.push(await toCustomDomainServiceDomain(row, config));
  }

  return { domains };
}

export async function getCustomDomain(input: CustomDomainHostInput): Promise<CustomDomainServiceResult> {
  const config: ApiConfig = getApiConfig();
  const host: string = normalizeCustomDomainHost(input.host, config);
  const organizationId: string = await resolveOrganizationId(input);
  const row: CustomDomainRow = await requireCustomDomainForOrganization(organizationId, host);
  await requireVisibleCustomDomainPermission(input.principalId, organizationId, row.environmentId, 'domain.read');

  return await readCustomDomainResult(organizationId, row.host, config);
}

export async function verifyCustomDomain(input: CustomDomainHostInput): Promise<CustomDomainServiceResult> {
  const config: ApiConfig = getApiConfig();
  const host: string = normalizeCustomDomainHost(input.host, config);
  const organizationId: string = await resolveOrganizationId(input);
  const row: CustomDomainRow = await requireCustomDomainForOrganization(organizationId, host);
  await requireVisibleCustomDomainPermission(input.principalId, organizationId, row.environmentId, 'domain.write');
  await verifyAndPersistCustomDomain(row, host, config);
  if (row.edgeRoutingEnabled) {
    await synchronizeEdgeAppAccessState();
  }

  return await readCustomDomainResult(organizationId, host, config);
}

export async function removeCustomDomain(input: CustomDomainHostInput): Promise<RemovedCustomDomainResult> {
  const config: ApiConfig = getApiConfig();
  const host: string = normalizeCustomDomainHost(input.host, config);
  const organizationId: string = await resolveOrganizationId(input);
  const row: CustomDomainRow = await requireCustomDomainForOrganization(organizationId, host);
  await requireVisibleCustomDomainPermission(input.principalId, organizationId, row.environmentId, 'domain.write');
  await beginRemovalAndDisableEdge(row);

  return {
    host,
    removed: true,
  };
}

async function beginRemovalAndDisableEdge(row: CustomDomainRow): Promise<void> {
  const transition: CustomDomainDeletionTransition | null = await beginCustomDomainDeletion(row.id);
  if (transition === null) {
    return;
  }
  await synchronizeEdgeAppAccessState();
  await markCustomDomainDeletionReady(row.id, transition.deletionGeneration);
}

async function resolveCustomDomainTarget(
  input: AddCustomDomainInput,
  config: ApiConfig,
): Promise<ResolvedCustomDomainTarget> {
  assertRuntimeSupportsCustomDomains(config, readApiPublicIngressConfig());
  const targetScope: ResolvedCustomDomainTargetScope = await resolveCustomDomainTargetScope(input);
  await requireCustomDomainCanonicalRouteHost(targetScope, config);

  return {
    environment: targetScope.environment,
    organizationId: targetScope.organizationId,
    service: targetScope.service,
  };
}

async function resolveOrganizationId(input: CustomDomainHostInput): Promise<string> {
  const organization: OrganizationRow = await resolveRequiredOrganization(input.principalId, input.organizationSlug);

  return organization.id;
}

async function resolveCustomDomainListOrganizationId(input: ListCustomDomainsInput): Promise<string> {
  if (hasText(input.projectName)) {
    return await resolveProjectScopedCustomDomainListOrganizationId(input, input.projectName);
  }

  const organization: OrganizationRow = await resolveRequiredOrganization(input.principalId, input.organizationSlug);
  await requireOrganizationPermission(input.principalId, organization.id, 'domain.read');

  return organization.id;
}

async function verifyAndPersistCustomDomain(row: CustomDomainRow, host: string, config: ApiConfig): Promise<void> {
  const result: CustomDomainDnsVerificationResult = await verifyCustomDomainDns({
    canonicalRouteHost: await readCanonicalRouteHost(row, config),
    config: buildCustomDomainDnsConfig(config),
    domainId: row.id,
    host,
    hostPlan: readRuntimeDomainHostPlan(),
    verificationTokenHash: row.verificationTokenHash,
  });
  await persistCustomDomainVerificationResult(row, host, result);
}

async function resolveProjectScopedCustomDomainListOrganizationId(
  input: ListCustomDomainsInput,
  projectName: string,
): Promise<string> {
  const projectScope: ResolvedProjectScope =
    input.environmentName !== undefined
      ? await resolveActiveProjectScope(input.principalId, input.organizationSlug, projectName)
      : await resolveActiveProjectScope(input.principalId, input.organizationSlug, projectName, {
          permission: 'domain.read',
        });
  if (input.environmentName !== undefined) {
    const environment: EnvironmentRow = await resolveExistingEnvironment(
      projectScope.project.id,
      input.environmentName,
    );
    await requireCustomDomainPermission(input.principalId, projectScope.organization.id, environment.id, 'domain.read');
  }

  return projectScope.organization.id;
}

async function resolveCustomDomainTargetScope(input: AddCustomDomainInput): Promise<ResolvedCustomDomainTargetScope> {
  const projectScope: ResolvedProjectScope = await resolveActiveProjectScope(
    input.principalId,
    input.organizationSlug,
    input.projectName,
  );
  const environment: EnvironmentRow = await resolveExistingEnvironment(
    projectScope.project.id,
    input.environmentName ?? defaultCompartmentEnvironmentName,
  );
  await requireCustomDomainPermission(input.principalId, projectScope.organization.id, environment.id, 'domain.write');

  return {
    environment,
    organizationId: projectScope.organization.id,
    service: await resolveRequiredProjectService(projectScope.project.id, input.serviceName),
  };
}

async function requireCustomDomainCanonicalRouteHost(
  targetScope: ResolvedCustomDomainTargetScope,
  config: ApiConfig,
): Promise<string> {
  const route: DeploymentRouteLookupRow | undefined = await findActiveDeploymentRouteByOwner(
    targetScope.environment.id,
    targetScope.service.id,
    config.baseDomain,
  );
  if (route === undefined) {
    throw createActiveDeploymentNotFoundError();
  }

  return route.host;
}
