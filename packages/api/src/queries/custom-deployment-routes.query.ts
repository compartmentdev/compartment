import { and, asc, eq, inArray, type SQL } from 'drizzle-orm';
import {
  deploymentCustomDomains,
  deploymentRoutes,
  deployments,
  environments,
  organizations,
  projectServices,
  projects,
} from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { createDeploymentRouteLookupSelection } from './deployment-route-lookup-selection';
import type {
  CustomDeploymentRouteLookupQuery,
  CustomDeploymentRouteLookupSelection,
  DeploymentRouteLookupRow,
  PersistedCustomDeploymentRouteLookupRow,
} from './deployment-routes.query.types';

const customDeploymentRouteLookupSelection: CustomDeploymentRouteLookupSelection = {
  ...createDeploymentRouteLookupSelection(),
  host: deploymentCustomDomains.host,
};

export async function findActiveCustomDeploymentRouteByHost(
  host: string,
): Promise<DeploymentRouteLookupRow | undefined> {
  const rows: PersistedCustomDeploymentRouteLookupRow[] = await createCustomDeploymentRouteLookupQuery()
    .where(and(buildVerifiedCustomDomainPredicate(), eq(deploymentCustomDomains.host, host)))
    .limit(1);

  return rows[0];
}

export async function listActiveCustomDeploymentRoutes(): Promise<DeploymentRouteLookupRow[]> {
  const rows: PersistedCustomDeploymentRouteLookupRow[] = await createCustomDeploymentRouteLookupQuery()
    .where(buildVerifiedCustomDomainPredicate())
    .orderBy(asc(deploymentCustomDomains.host));

  return rows;
}

export async function listActiveCustomDeploymentRoutesForProjects(
  projectIds: string[],
): Promise<DeploymentRouteLookupRow[]> {
  if (projectIds.length === 0) {
    return [];
  }

  const rows: PersistedCustomDeploymentRouteLookupRow[] = await createCustomDeploymentRouteLookupQuery()
    .where(and(buildVerifiedCustomDomainPredicate(), inArray(projects.id, projectIds)))
    .orderBy(asc(projects.name), asc(projectServices.name), asc(deploymentCustomDomains.host));

  return rows;
}

function createCustomDeploymentRouteLookupQuery(): CustomDeploymentRouteLookupQuery {
  return getApiDatabase()
    .select(customDeploymentRouteLookupSelection)
    .from(deploymentCustomDomains)
    .innerJoin(environments, eq(deploymentCustomDomains.environmentId, environments.id))
    .innerJoin(projects, eq(environments.projectId, projects.id))
    .innerJoin(organizations, eq(projects.organizationId, organizations.id))
    .innerJoin(projectServices, eq(deploymentCustomDomains.projectServiceId, projectServices.id))
    .innerJoin(
      deployments,
      and(
        eq(deployments.environmentId, deploymentCustomDomains.environmentId),
        eq(deployments.projectServiceId, deploymentCustomDomains.projectServiceId),
      ),
    )
    .innerJoin(deploymentRoutes, eq(deploymentRoutes.deploymentId, deployments.id));
}

function buildVerifiedCustomDomainPredicate(): SQL {
  return and(
    eq(deployments.isActive, true),
    eq(deploymentCustomDomains.ownershipStatus, 'valid'),
    eq(deploymentCustomDomains.routingStatus, 'valid'),
  )!;
}
