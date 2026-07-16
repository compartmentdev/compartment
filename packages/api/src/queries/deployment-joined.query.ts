import { and, asc, desc, eq, exists, inArray, or, type SQL } from 'drizzle-orm';
import {
  buildArtifacts,
  deploymentKubeReferences,
  deploymentRoutes,
  deployments,
  environments,
  operations,
  projectServices,
  projects,
} from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { toDeploymentJoinedRow } from './deployment-joined-row.mapper';
import type {
  DeploymentJoinedRow,
  JoinedDeploymentQuery,
  JoinedDeploymentSelection,
  PersistedDeploymentJoinedRow,
} from './deployments.query.types';

const joinedDeploymentSelection: JoinedDeploymentSelection = {
  deployment: deployments,
  environment: environments,
  operation: operations,
  project: projects,
  artifact: buildArtifacts,
  routeSubdomain: deploymentRoutes.subdomain,
  service: projectServices,
};

type JoinedDeploymentOrder = 'created-desc' | 'service-asc';
export async function findJoinedDeploymentById(
  deploymentId: string,
  routeBaseDomain: string,
): Promise<DeploymentJoinedRow | undefined> {
  const rows: DeploymentJoinedRow[] = await readJoinedDeploymentRows(
    eq(deployments.id, deploymentId),
    'created-desc',
    routeBaseDomain,
    1,
  );
  return rows[0];
}

export async function findJoinedDeploymentByEnvironmentAndId(
  environmentId: string,
  deploymentId: string,
  routeBaseDomain: string,
): Promise<DeploymentJoinedRow | undefined> {
  const rows: DeploymentJoinedRow[] = await readJoinedDeploymentRows(
    requireDeploymentFilter(and(eq(deployments.environmentId, environmentId), eq(deployments.id, deploymentId))),
    'created-desc',
    routeBaseDomain,
    1,
  );
  return rows[0];
}
export async function findLatestJoinedDeployment(
  environmentId: string,
  projectServiceId: string,
  routeBaseDomain: string,
): Promise<DeploymentJoinedRow | undefined> {
  const rows: DeploymentJoinedRow[] = await readScopedJoinedDeploymentRows(
    environmentId,
    projectServiceId,
    false,
    routeBaseDomain,
  );
  return rows[0];
}
export async function findActiveJoinedDeployment(
  environmentId: string,
  projectServiceId: string,
  routeBaseDomain: string,
): Promise<DeploymentJoinedRow | undefined> {
  const rows: DeploymentJoinedRow[] = await readScopedJoinedDeploymentRows(
    environmentId,
    projectServiceId,
    true,
    routeBaseDomain,
  );
  return rows[0];
}
export async function listActiveJoinedDeploymentsForEnvironment(
  environmentId: string,
  routeBaseDomain: string,
): Promise<DeploymentJoinedRow[]> {
  return await readJoinedDeploymentRows(
    requireDeploymentFilter(and(eq(deployments.environmentId, environmentId), eq(deployments.isActive, true))),
    'service-asc',
    routeBaseDomain,
  );
}
export async function listJoinedDeploymentsForService(
  environmentId: string,
  projectServiceId: string,
  routeBaseDomain: string,
  limit?: number,
): Promise<DeploymentJoinedRow[]> {
  return await readJoinedDeploymentRows(
    buildScopedDeploymentFilter(environmentId, projectServiceId, false),
    'created-desc',
    routeBaseDomain,
    limit,
  );
}

export async function listJoinedDeploymentsByProjectService(
  projectServiceId: string,
  routeBaseDomain: string,
): Promise<DeploymentJoinedRow[]> {
  return await readJoinedDeploymentRows(
    requireDeploymentFilter(eq(deployments.projectServiceId, projectServiceId)),
    'created-desc',
    routeBaseDomain,
  );
}

export async function listJoinedDeploymentsForEnvironment(
  environmentId: string,
  routeBaseDomain: string,
  limit?: number,
): Promise<DeploymentJoinedRow[]> {
  return await readJoinedDeploymentRows(
    requireDeploymentFilter(eq(deployments.environmentId, environmentId)),
    'created-desc',
    routeBaseDomain,
    limit,
  );
}
export async function listJoinedDeploymentsForEnvironmentRun(
  environmentId: string,
  deploymentRunId: string,
  routeBaseDomain: string,
): Promise<DeploymentJoinedRow[]> {
  return await readJoinedDeploymentRows(
    requireDeploymentFilter(
      and(eq(deployments.environmentId, environmentId), eq(deployments.deploymentRunId, deploymentRunId)),
    ),
    'service-asc',
    routeBaseDomain,
  );
}

export async function listRuntimeJoinedDeploymentsForProject(
  projectId: string,
  routeBaseDomain: string,
): Promise<DeploymentJoinedRow[]> {
  return await readJoinedDeploymentRows(buildProjectRuntimeDeploymentFilter(projectId), 'service-asc', routeBaseDomain);
}

export async function listJoinedDeploymentsForProjects(
  projectIds: readonly string[],
  routeBaseDomain: string,
): Promise<DeploymentJoinedRow[]> {
  if (projectIds.length === 0) {
    return [];
  }

  return await readJoinedDeploymentRows(
    requireDeploymentFilter(inArray(projects.id, [...projectIds])),
    'created-desc',
    routeBaseDomain,
  );
}

export async function listActiveJoinedDeploymentsForProjects(
  projectIds: readonly string[],
  routeBaseDomain: string,
): Promise<DeploymentJoinedRow[]> {
  if (projectIds.length === 0) {
    return [];
  }

  return await readJoinedDeploymentRows(
    requireDeploymentFilter(and(inArray(projects.id, [...projectIds]), eq(deployments.isActive, true))),
    'service-asc',
    routeBaseDomain,
  );
}

async function readScopedJoinedDeploymentRows(
  environmentId: string,
  projectServiceId: string,
  activeOnly: boolean,
  routeBaseDomain: string,
): Promise<DeploymentJoinedRow[]> {
  return await readJoinedDeploymentRows(
    buildScopedDeploymentFilter(environmentId, projectServiceId, activeOnly),
    'created-desc',
    routeBaseDomain,
    1,
  );
}

async function readJoinedDeploymentRows(
  filter: SQL,
  order: JoinedDeploymentOrder,
  routeBaseDomain: string,
  limit?: number,
): Promise<DeploymentJoinedRow[]> {
  const rows: PersistedDeploymentJoinedRow[] =
    limit === undefined
      ? await createJoinedDeploymentBaseQuery(filter, order)
      : await createJoinedDeploymentBaseQuery(filter, order).limit(limit);
  return rows.map(
    (row: PersistedDeploymentJoinedRow): DeploymentJoinedRow => toDeploymentJoinedRow(row, routeBaseDomain),
  );
}

function createJoinedDeploymentBaseQuery(filter: SQL, order: JoinedDeploymentOrder): JoinedDeploymentQuery {
  return getApiDatabase()
    .select(joinedDeploymentSelection)
    .from(deployments)
    .innerJoin(environments, eq(deployments.environmentId, environments.id))
    .innerJoin(projects, eq(environments.projectId, projects.id))
    .innerJoin(projectServices, eq(deployments.projectServiceId, projectServices.id))
    .innerJoin(buildArtifacts, eq(deployments.buildArtifactId, buildArtifacts.id))
    .innerJoin(operations, eq(deployments.operationId, operations.id))
    .leftJoin(deploymentRoutes, eq(deploymentRoutes.deploymentId, deployments.id))
    .where(filter)
    .orderBy(resolveJoinedDeploymentOrder(order));
}

function buildScopedDeploymentFilter(environmentId: string, projectServiceId: string, activeOnly: boolean): SQL {
  return requireDeploymentFilter(
    activeOnly
      ? and(
          eq(deployments.environmentId, environmentId),
          eq(deployments.projectServiceId, projectServiceId),
          eq(deployments.isActive, true),
        )
      : and(eq(deployments.environmentId, environmentId), eq(deployments.projectServiceId, projectServiceId)),
  );
}

function buildProjectRuntimeDeploymentFilter(projectId: string): SQL {
  const hasUnfinishedKubeRuntime: SQL = exists(
    getApiDatabase()
      .select({ id: deploymentKubeReferences.id })
      .from(deploymentKubeReferences)
      .where(
        and(
          eq(deploymentKubeReferences.deploymentId, deployments.id),
          or(
            inArray(deploymentKubeReferences.state, ['active', 'desired', 'pending', 'stopping']),
            and(eq(deploymentKubeReferences.state, 'stopped'), eq(deployments.status, 'running')),
          ),
        ),
      ),
  );
  return requireDeploymentFilter(
    and(eq(projects.id, projectId), or(eq(deployments.isActive, true), hasUnfinishedKubeRuntime)),
  );
}

function requireDeploymentFilter(filter: SQL | undefined): SQL {
  if (filter === undefined) {
    throw new Error('Expected deployment query filter.');
  }
  return filter;
}

function resolveJoinedDeploymentOrder(order: JoinedDeploymentOrder): SQL {
  return order === 'service-asc' ? asc(projectServices.name) : desc(deployments.createdAt);
}
