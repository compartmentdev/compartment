import { and, eq, inArray } from 'drizzle-orm';
import { deploymentKubeReferences, deployments } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type { DeploymentKubeInspectReference } from './deployment-kube-inspect.query.types';

export async function findDeploymentKubeReference(
  deploymentId: string,
): Promise<DeploymentKubeInspectReference | undefined> {
  const [reference] = await getApiDatabase()
    .select({ namespace: deploymentKubeReferences.namespace, serviceName: deploymentKubeReferences.serviceName })
    .from(deploymentKubeReferences)
    .innerJoin(deployments, eq(deployments.id, deploymentKubeReferences.deploymentId))
    .where(
      and(
        eq(deploymentKubeReferences.deploymentId, deploymentId),
        inArray(deploymentKubeReferences.state, ['desired', 'pending', 'active']),
        inArray(deployments.status, ['running', 'succeeded']),
      ),
    );
  return reference;
}
