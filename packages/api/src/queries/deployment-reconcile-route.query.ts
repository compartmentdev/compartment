import { and, eq } from 'drizzle-orm';
import { deploymentRoutes, deployments } from '../db/schema';
import type { SupersedeCandidateContext } from './deployment-reconcile-supersede.query';
import type { PersistDeploymentReconcileObservationInput } from './deployment-reconcile.query.types';
import type { DeploymentTransaction } from './deployments.query.types';

interface ReconcileRouteRow {
  id: string;
}

export async function switchReadyDeploymentRoute(
  tx: DeploymentTransaction,
  input: PersistDeploymentReconcileObservationInput,
  candidate: SupersedeCandidateContext,
): Promise<void> {
  const route: ReconcileRouteRow | undefined = await findReconcileRoute(tx, candidate);
  if (route === undefined) {
    return;
  }
  await tx
    .update(deploymentRoutes)
    .set({
      accessScopeId: candidate.environmentId,
      accessScopeType: 'environment',
      deploymentId: input.deploymentId,
      updatedAt: input.observedAt,
    })
    .where(eq(deploymentRoutes.id, route.id));
}

async function findReconcileRoute(
  tx: DeploymentTransaction,
  candidate: SupersedeCandidateContext,
): Promise<ReconcileRouteRow | undefined> {
  const [route] = await tx
    .select({ id: deploymentRoutes.id })
    .from(deploymentRoutes)
    .innerJoin(deployments, eq(deploymentRoutes.deploymentId, deployments.id))
    .where(
      and(
        eq(deployments.environmentId, candidate.environmentId),
        eq(deployments.projectServiceId, candidate.serviceId),
      ),
    )
    .limit(1);
  return route;
}
