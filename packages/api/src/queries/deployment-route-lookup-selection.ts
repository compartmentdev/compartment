import { deploymentRoutes, deployments, environments, organizations, projectServices, projects } from '../db/schema';
import type { DeploymentRouteLookupSelection } from './deployment-routes.query.types';

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
    upstreamHost: deployments.upstreamHost,
    upstreamPort: deployments.upstreamPort,
    serviceId: projectServices.id,
    serviceName: projectServices.name,
    subdomain: deploymentRoutes.subdomain,
  };
}
