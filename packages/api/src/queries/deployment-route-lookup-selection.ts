import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  deploymentKubeReferences,
  deploymentRoutes,
  deployments,
  environments,
  organizations,
  projectServices,
  projects,
} from '../db/schema';
import type { DeploymentRouteLookupQuery, DeploymentRouteLookupSelection } from './deployment-routes.query.types';
import { getApiDatabase } from '../runtime/runtime-access';
import { buildDeploymentUpstreamHostExpression } from './deployment-upstream-host.query.support';

export function createDeploymentRouteLookupQuery(): DeploymentRouteLookupQuery {
  return getApiDatabase()
    .select(createDeploymentRouteLookupSelection())
    .from(deploymentRoutes)
    .innerJoin(deployments, eq(deploymentRoutes.deploymentId, deployments.id))
    .innerJoin(environments, eq(deployments.environmentId, environments.id))
    .innerJoin(projects, eq(environments.projectId, projects.id))
    .innerJoin(organizations, eq(projects.organizationId, organizations.id))
    .innerJoin(projectServices, eq(deployments.projectServiceId, projectServices.id))
    .innerJoin(
      deploymentKubeReferences,
      and(eq(deploymentKubeReferences.deploymentId, deployments.id), buildPublishedDeploymentReferenceFilter()),
    );
}

export function buildPublishedDeploymentReferenceFilter(): SQL {
  return inArray(deploymentKubeReferences.state, ['active', 'pending']);
}

export function createDeploymentRouteLookupSelection(): DeploymentRouteLookupSelection {
  return {
    accessMode: deployments.accessMode,
    accessScopeId: deploymentRoutes.accessScopeId,
    accessScopeType: deploymentRoutes.accessScopeType,
    deploymentId: deploymentRoutes.deploymentId,
    environmentId: environments.id,
    environmentName: environments.name,
    organizationId: organizations.id,
    organizationSlug: organizations.slug,
    projectId: projects.id,
    projectName: projects.name,
    resolvedRoutesJson: deployments.resolvedRoutesJson,
    upstreamHost: buildDeploymentUpstreamHostExpression(),
    upstreamPort: sql<number>`80`,
    serviceId: projectServices.id,
    serviceName: projectServices.name,
    subdomain: deploymentRoutes.subdomain,
  };
}
