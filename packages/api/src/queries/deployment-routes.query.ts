import type { CompartmentAccessScopeType } from '@compartment/contracts';
import { and, asc, desc, eq, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import { deploymentRoutes, deployments, environments, organizations, projectServices, projects } from '../db/schema';
import { buildPublicRouteHost } from '../lib/public-route-host';
import { getApiDatabase } from '../runtime/runtime-access';
import { findActiveCustomDeploymentRouteByHost } from './custom-deployment-routes.query';
import { createDeploymentRouteLookupSelection } from './deployment-route-lookup-selection';
import type {
  DeploymentRouteLookupSelection,
  DeploymentRouteLookupQuery,
  DeploymentRouteLookupRow,
  DeploymentRouteSubdomainRow,
  DeploymentRouteOwnerRow,
  DeploymentRouteOwnerSelection,
  DeploymentRouteQueryExecutor,
  InsertedDeploymentRouteRow,
  PersistedDeploymentRouteLookupRow,
  UpsertDeploymentRouteInput,
} from './deployment-routes.query.types';

interface DeploymentRouteInsertInput {
  accessScopeId: string;
  accessScopeType: CompartmentAccessScopeType;
  deploymentId: string;
  id: string;
  subdomain: string;
  updatedAt: Date;
}

const deploymentRouteLookupSelection: DeploymentRouteLookupSelection = createDeploymentRouteLookupSelection();

const deploymentRouteOwnerSelection: DeploymentRouteOwnerSelection = {
  environmentId: deployments.environmentId,
  serviceId: deployments.projectServiceId,
  subdomain: deploymentRoutes.subdomain,
};

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

export async function upsertDeploymentRouteWithExecutor(
  executor: DeploymentRouteQueryExecutor,
  input: UpsertDeploymentRouteInput,
): Promise<void> {
  if (await tryInsertDeploymentRouteWithExecutor(executor, input)) {
    return;
  }

  const existingRouteOwner: DeploymentRouteOwnerRow | undefined = await findDeploymentRouteOwnerBySubdomainWithExecutor(
    executor,
    input.subdomain,
  );
  if (existingRouteOwner === undefined || !isMatchingDeploymentRouteOwner(existingRouteOwner, input)) {
    throw createDeploymentRouteConflictError(input.subdomain);
  }

  await executor
    .update(deploymentRoutes)
    .set({
      accessScopeId: input.accessScopeId,
      accessScopeType: input.accessScopeType,
      deploymentId: input.deploymentId,
      updatedAt: input.updatedAt,
    })
    .where(eq(deploymentRoutes.subdomain, input.subdomain));
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

function createDeploymentRouteLookupQuery(): DeploymentRouteLookupQuery {
  return getApiDatabase()
    .select(deploymentRouteLookupSelection)
    .from(deploymentRoutes)
    .innerJoin(deployments, eq(deploymentRoutes.deploymentId, deployments.id))
    .innerJoin(environments, eq(deployments.environmentId, environments.id))
    .innerJoin(projects, eq(environments.projectId, projects.id))
    .innerJoin(organizations, eq(projects.organizationId, organizations.id))
    .innerJoin(projectServices, eq(deployments.projectServiceId, projectServices.id));
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

export async function tryInsertDeploymentRouteWithExecutor(
  executor: DeploymentRouteQueryExecutor,
  input: UpsertDeploymentRouteInput,
): Promise<boolean> {
  const insertedRoutes: InsertedDeploymentRouteRow[] = await executor
    .insert(deploymentRoutes)
    .values(buildDeploymentRouteInsertInput(input))
    .onConflictDoNothing({
      target: deploymentRoutes.subdomain,
    })
    .returning({ id: deploymentRoutes.id });

  return insertedRoutes.length > 0;
}

function buildDeploymentRouteInsertInput(input: UpsertDeploymentRouteInput): DeploymentRouteInsertInput {
  return {
    accessScopeId: input.accessScopeId,
    accessScopeType: input.accessScopeType,
    deploymentId: input.deploymentId,
    id: input.id,
    subdomain: input.subdomain,
    updatedAt: input.updatedAt,
  };
}

async function findDeploymentRouteOwnerBySubdomainWithExecutor(
  executor: DeploymentRouteQueryExecutor,
  routeSubdomain: string,
): Promise<DeploymentRouteOwnerRow | undefined> {
  const rows: DeploymentRouteOwnerRow[] = await executor
    .select(deploymentRouteOwnerSelection)
    .from(deploymentRoutes)
    .innerJoin(deployments, eq(deploymentRoutes.deploymentId, deployments.id))
    .where(eq(deploymentRoutes.subdomain, routeSubdomain))
    .limit(1);

  return rows[0];
}

function isMatchingDeploymentRouteOwner(
  existingRouteOwner: DeploymentRouteOwnerRow,
  input: UpsertDeploymentRouteInput,
): boolean {
  return existingRouteOwner.environmentId === input.environmentId && existingRouteOwner.serviceId === input.serviceId;
}

function createDeploymentRouteConflictError(routeSubdomain: string): Error {
  return new Error(`Public route subdomain ${routeSubdomain} is already assigned to another deployment route.`);
}
