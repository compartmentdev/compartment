import { and, eq, inArray, sql } from 'drizzle-orm';
import { deploymentKubeReferences } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type { DeploymentKubeState } from './deployment-kube-state.types';

export async function findDeploymentKubeState(deploymentId: string): Promise<DeploymentKubeState | undefined> {
  const [reference] = await getApiDatabase()
    .select({ state: deploymentKubeReferences.state })
    .from(deploymentKubeReferences)
    .where(eq(deploymentKubeReferences.deploymentId, deploymentId))
    .limit(1);
  return reference?.state;
}

export async function requestDeploymentKubeStop(deploymentId: string, updatedAt: Date): Promise<void> {
  await getApiDatabase()
    .update(deploymentKubeReferences)
    .set({
      revision: sql`${deploymentKubeReferences.revision} + 1`,
      state: 'stopping',
      transitionedAt: updatedAt,
      updatedAt,
    })
    .where(
      and(
        eq(deploymentKubeReferences.deploymentId, deploymentId),
        inArray(deploymentKubeReferences.state, ['active', 'desired', 'pending']),
      ),
    );
}
