import { and, eq, inArray } from 'drizzle-orm';
import type { ApiDatabaseTransaction } from '../db/client.types';
import { deploymentKubeReferences, deployments, environments, projects } from '../db/schema';
import type { DeploymentUsageOwner } from './deployment-usage-owner.query.types';
import { buildDeploymentUpstreamHostExpression } from './deployment-upstream-host.query.support';

export async function readDeploymentUsageOwner(
  tx: ApiDatabaseTransaction,
  deploymentId: string,
): Promise<DeploymentUsageOwner | undefined> {
  const [owner] = await tx
    .select({
      environmentId: deployments.environmentId,
      organizationId: projects.organizationId,
      projectId: environments.projectId,
      serviceId: deployments.projectServiceId,
    })
    .from(deployments)
    .innerJoin(environments, eq(environments.id, deployments.environmentId))
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .where(eq(deployments.id, deploymentId))
    .limit(1);
  return owner;
}

export async function readDeploymentUsageOwnerByUpstreamHost(
  tx: ApiDatabaseTransaction,
  upstreamHost: string,
): Promise<DeploymentUsageOwner | undefined> {
  const [owner] = await tx
    .selectDistinct({
      environmentId: deployments.environmentId,
      organizationId: projects.organizationId,
      projectId: environments.projectId,
      serviceId: deployments.projectServiceId,
    })
    .from(deploymentKubeReferences)
    .innerJoin(deployments, eq(deployments.id, deploymentKubeReferences.deploymentId))
    .innerJoin(environments, eq(environments.id, deployments.environmentId))
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .where(
      and(
        eq(buildDeploymentUpstreamHostExpression(), upstreamHost),
        inArray(deploymentKubeReferences.state, ['active', 'stopping', 'stopped']),
      ),
    )
    .limit(1);
  return owner;
}
