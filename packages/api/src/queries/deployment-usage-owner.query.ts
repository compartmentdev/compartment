import { eq } from 'drizzle-orm';
import type { ApiDatabaseTransaction } from '../db/client.types';
import { deployments, environments, projects } from '../db/schema';
import type { DeploymentUsageOwner } from './deployment-usage-owner.query.types';

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
