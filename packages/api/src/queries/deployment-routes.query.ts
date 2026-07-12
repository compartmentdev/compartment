import { and, asc, desc, eq, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import { deploymentRoutes, deployments, projectServices } from '../db/schema';
import { buildPublicRouteHost } from '../lib/public-route-host';
import { getApiDatabase } from '../runtime/runtime-access';
import { findActiveCustomDeploymentRouteByHost } from './custom-deployment-routes.query';
import { createDeploymentRouteLookupQuery } from './deployment-route-lookup-selection';
import type {
  DeploymentRouteLookupRow,
  DeploymentRouteSubdomainRow,
  PersistedDeploymentRouteLookupRow,
} from './deployment-routes.query.types';

export async function findActiveDeploymentRouteByHost(
  host: string,
  baseDomain: string,
): Promise<DeploymentRouteLookupRow | undefined> {
  return (
    (await findActiveCanonicalDeploymentRouteByHost(host, baseDomain)) ??
    (await findActiveCustomDeploymentRouteByHost(host))
  );
}

export async function findActiveDeploymentRouteByOwner(
  environmentId: string,
  serviceId: string,
  baseDomain: string,
): Promise<DeploymentRouteLookupRow | undefined> {
  const rows: PersistedDeploymentRouteLookupRow[] = await createDeploymentRouteLookupQuery()
    .where(
      and(
        eq(deployments.isActive, true),
        eq(deployments.environmentId, environmentId),
        eq(deployments.projectServiceId, serviceId),
      ),
    )
    .limit(1);

  return rows[0] === undefined ? undefined : toDeploymentRouteLookupRow(rows[0], baseDomain);
}

export async function findActiveDeploymentRouteByEnvironmentServiceName(
  environmentId: string,
  serviceName: string,
  baseDomain: string,
): Promise<DeploymentRouteLookupRow | undefined> {
  const rows: PersistedDeploymentRouteLookupRow[] = await createDeploymentRouteLookupQuery()
    .where(
      and(
        eq(deployments.isActive, true),
        eq(deployments.environmentId, environmentId),
        eq(projectServices.name, serviceName),
      ),
    )
    .limit(1);

  return rows[0] === undefined ? undefined : toDeploymentRouteLookupRow(rows[0], baseDomain);
}

export async function listActiveDeploymentRoutes(baseDomain: string): Promise<DeploymentRouteLookupRow[]> {
  const rows: PersistedDeploymentRouteLookupRow[] = await createDeploymentRouteLookupQuery()
    .where(eq(deployments.isActive, true))
    .orderBy(asc(deploymentRoutes.subdomain));

  return rows.map(
    (row: PersistedDeploymentRouteLookupRow): DeploymentRouteLookupRow => toDeploymentRouteLookupRow(row, baseDomain),
  );
}

export async function findLatestPublishedDeploymentRouteSubdomainForOwner(
  environmentId: string,
  serviceId: string,
): Promise<string | undefined> {
  return await findLatestDeploymentRouteSubdomainForOwner(
    buildPublishedDeploymentRouteOwnerFilter(environmentId, serviceId),
  );
}

export async function findLatestReservedDeploymentRouteSubdomainForOwner(
  environmentId: string,
  serviceId: string,
): Promise<string | undefined> {
  return await findLatestDeploymentRouteSubdomainForOwner(
    buildReservedDeploymentRouteOwnerFilter(environmentId, serviceId),
  );
}

async function findLatestDeploymentRouteSubdomainForOwner(filter: SQL): Promise<string | undefined> {
  const rows: DeploymentRouteSubdomainRow[] = await getApiDatabase()
    .select({ subdomain: deploymentRoutes.subdomain })
    .from(deploymentRoutes)
    .innerJoin(deployments, eq(deploymentRoutes.deploymentId, deployments.id))
    .where(filter)
    .orderBy(desc(deploymentRoutes.updatedAt))
    .limit(1);

  return rows[0]?.subdomain;
}

function buildPublishedDeploymentRouteOwnerFilter(environmentId: string, serviceId: string): SQL {
  const publishedStatusFilter: SQL = requireDeploymentRouteOwnerFilter(
    or(eq(deployments.status, 'succeeded'), eq(deployments.status, 'stopped')),
    'Expected published deployment route status filter.',
  );

  // A route stays published after project archive stops the runtime.
  return requireDeploymentRouteOwnerFilter(
    and(
      eq(deployments.environmentId, environmentId),
      eq(deployments.projectServiceId, serviceId),
      isNotNull(deployments.completedAt),
      publishedStatusFilter,
    ),
    'Expected published deployment route owner filter.',
  );
}

function buildReservedDeploymentRouteOwnerFilter(environmentId: string, serviceId: string): SQL {
  return requireDeploymentRouteOwnerFilter(
    and(eq(deployments.environmentId, environmentId), eq(deployments.projectServiceId, serviceId)),
    'Expected reserved deployment route owner filter.',
  );
}

function requireDeploymentRouteOwnerFilter(filter: SQL | undefined, errorMessage: string): SQL {
  if (filter === undefined) {
    throw new Error(errorMessage);
  }

  return filter;
}

export async function listDeploymentRouteSubdomains(): Promise<string[]> {
  const rows: DeploymentRouteSubdomainRow[] = await getApiDatabase()
    .select({ subdomain: deploymentRoutes.subdomain })
    .from(deploymentRoutes)
    .orderBy(asc(deploymentRoutes.subdomain));

  return rows.map((row: DeploymentRouteSubdomainRow): string => row.subdomain);
}

async function findActiveCanonicalDeploymentRouteByHost(
  host: string,
  baseDomain: string,
): Promise<DeploymentRouteLookupRow | undefined> {
  const rows: PersistedDeploymentRouteLookupRow[] = await createDeploymentRouteLookupQuery()
    .where(and(eq(deployments.isActive, true), buildPublicRouteHostMatch(host, baseDomain)))
    .limit(1);

  return rows[0] === undefined ? undefined : toDeploymentRouteLookupRow(rows[0], baseDomain);
}

function toDeploymentRouteLookupRow(
  row: PersistedDeploymentRouteLookupRow,
  baseDomain: string,
): DeploymentRouteLookupRow {
  return {
    ...row,
    host: buildPublicRouteHost(baseDomain, row.subdomain),
  };
}

function buildPublicRouteHostMatch(host: string, baseDomain: string): SQL {
  const routeSubdomain: string | null = readRouteSubdomainFromHost(host, baseDomain);

  return routeSubdomain === null ? sql`false` : eq(deploymentRoutes.subdomain, routeSubdomain);
}

function readRouteSubdomainFromHost(host: string, baseDomain: string): string | null {
  const suffix: string = `.${baseDomain}`;
  if (!host.endsWith(suffix)) {
    return null;
  }

  const routeSubdomain: string = host.slice(0, -suffix.length);
  return routeSubdomain.length === 0 ? null : routeSubdomain;
}
