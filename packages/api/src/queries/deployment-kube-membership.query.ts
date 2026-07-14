import { eq } from 'drizzle-orm';
import { deploymentKubeReferences } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';

export async function hasDeploymentKubeReference(deploymentId: string): Promise<boolean> {
  const [reference] = await getApiDatabase()
    .select({ deploymentId: deploymentKubeReferences.deploymentId })
    .from(deploymentKubeReferences)
    .where(eq(deploymentKubeReferences.deploymentId, deploymentId))
    .limit(1);
  return reference !== undefined;
}
