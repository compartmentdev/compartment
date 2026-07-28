import { readApiPublicIngressConfig, type ApiConfig } from '../config';
import { createActiveDeploymentNotFoundError, createCustomDomainNotFoundError } from '../errors/api-business-error';
import { buildPublicRouteHost } from '../lib/public-route-host';
import { findCustomDomainForOrganization } from '../queries/custom-domains.query';
import type { CustomDomainRow } from '../queries/custom-domains.query.types';
import { findLatestPublishedDeploymentRouteSubdomainForOwner } from '../queries/deployment-routes.query';
import { buildCustomDomainDnsRecords } from './custom-domain-dns.service';
import type { CustomDomainDnsConfig } from './custom-domain-dns.service.types';
import type {
  CustomDomainServiceDomain,
  CustomDomainServiceResult,
  CustomDomainServiceState,
} from './custom-domain.service.types';
import { readRuntimeDomainHostPlan } from './system-domain-runtime.service';

export async function readCustomDomainResult(
  organizationId: string,
  host: string,
  config: ApiConfig,
): Promise<CustomDomainServiceResult> {
  const row: CustomDomainRow = await requireCustomDomainForOrganization(organizationId, host);
  const canonicalRouteHost: string = await readCanonicalRouteHost(row, config);

  return {
    dnsRecords: buildCustomDomainDnsRecords({
      canonicalRouteHost,
      config: buildCustomDomainDnsConfig(config),
      domainId: row.id,
      host,
      hostPlan: readRuntimeDomainHostPlan(),
    }),
    domain: toCustomDomainServiceDomainWithCanonicalHost(row, canonicalRouteHost),
  };
}

export async function requireCustomDomainForOrganization(
  organizationId: string,
  host: string,
): Promise<CustomDomainRow> {
  const row: CustomDomainRow | undefined = await findCustomDomainForOrganization(organizationId, host);
  if (row === undefined) {
    throw createCustomDomainNotFoundError();
  }

  return row;
}

export async function toCustomDomainServiceDomain(
  row: CustomDomainRow,
  config: ApiConfig,
): Promise<CustomDomainServiceDomain> {
  return toCustomDomainServiceDomainWithCanonicalHost(row, await readCanonicalRouteHost(row, config));
}

export async function readCanonicalRouteHost(row: CustomDomainRow, config: ApiConfig): Promise<string> {
  const routeSubdomain: string | undefined = await findLatestPublishedDeploymentRouteSubdomainForOwner(
    row.environmentId,
    row.serviceId,
  );
  if (routeSubdomain !== undefined) {
    return buildPublicRouteHost(config.baseDomain, routeSubdomain);
  }

  throw createActiveDeploymentNotFoundError();
}

function toCustomDomainServiceDomainWithCanonicalHost(
  row: CustomDomainRow,
  canonicalRouteHost: string,
): CustomDomainServiceDomain {
  return {
    canonicalRouteHost,
    createdAt: row.createdAt,
    environmentName: row.environmentName,
    failureMessage: row.failureMessage,
    host: row.host,
    lastCheckedAt: row.lastCheckedAt,
    ownershipStatus: row.ownershipStatus,
    projectName: row.projectName,
    routingStatus: row.routingStatus,
    serviceName: row.serviceName,
    status: readCustomDomainState(row),
    updatedAt: row.updatedAt,
    verifiedAt: row.verifiedAt,
  };
}

function readCustomDomainState(row: CustomDomainRow): CustomDomainServiceState {
  return row.reconcileState;
}

function buildCustomDomainDnsConfig(config: ApiConfig): CustomDomainDnsConfig {
  return {
    ...readApiPublicIngressConfig(),
    sessionSecret: config.sessionSecret,
  };
}
