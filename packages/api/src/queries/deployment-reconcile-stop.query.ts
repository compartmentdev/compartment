import { eq, sql } from 'drizzle-orm';
import { deploymentKubeReferences } from '../db/schema';
import type { DeploymentTransaction } from './deployments.query.types';
import type { PersistDeploymentReconcileObservationInput } from './deployment-reconcile.query.types';

export async function persistStoppedReconcileObservation(
  tx: DeploymentTransaction,
  input: PersistDeploymentReconcileObservationInput,
  state: string,
): Promise<boolean> {
  if (state !== 'stopping') {
    return false;
  }
  await tx
    .update(deploymentKubeReferences)
    .set({
      observedAt: input.observedAt,
      revision: sql`${deploymentKubeReferences.revision} + 1`,
      state: 'stopped',
      transitionedAt: input.observedAt,
      updatedAt: input.observedAt,
    })
    .where(eq(deploymentKubeReferences.deploymentId, input.deploymentId));
  return true;
}
