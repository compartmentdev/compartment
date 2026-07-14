import { and, eq } from 'drizzle-orm';
import { deploymentKubeReferences } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type { DeploymentKubeInspectReference } from './deployment-kube-inspect.query.types';

export async function findActiveDeploymentKubeReference(
  deploymentId: string,
): Promise<DeploymentKubeInspectReference | undefined> {
  const [reference] = await getApiDatabase()
    .select({ namespace: deploymentKubeReferences.namespace, serviceName: deploymentKubeReferences.serviceName })
    .from(deploymentKubeReferences)
    .where(and(eq(deploymentKubeReferences.deploymentId, deploymentId), eq(deploymentKubeReferences.state, 'active')));
  return reference;
}
