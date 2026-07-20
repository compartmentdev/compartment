import { and, desc, eq } from 'drizzle-orm';
import { deploymentKubeReferences, deploymentRoutes, deployments } from '../db/schema';
import { findLatestReservedDeploymentRouteForOwner } from './deployment-routes.query';
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
  previousActiveId: string | undefined,
): Promise<void> {
  const route: ReconcileRouteRow | undefined = await findReconcileRoute(
    tx,
    input.deploymentId,
    candidate,
    previousActiveId,
  );
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
  deploymentId: string,
  candidate: SupersedeCandidateContext,
  previousActiveId: string | undefined,
): Promise<ReconcileRouteRow | undefined> {
  const stoppedOwnerId: string | undefined =
    previousActiveId === undefined ? await findStoppedRouteOwnerId(tx, candidate) : undefined;
  for (const ownerId of [previousActiveId, stoppedOwnerId, deploymentId]) {
    if (ownerId === undefined) {
      continue;
    }
    const route: ReconcileRouteRow | undefined = await findRouteByDeploymentId(tx, ownerId);
    if (route !== undefined) {
      return route;
    }
  }
  return await findLatestReservedDeploymentRouteForOwner(tx, candidate.environmentId, candidate.serviceId);
}

async function findRouteByDeploymentId(
  tx: DeploymentTransaction,
  deploymentId: string,
): Promise<ReconcileRouteRow | undefined> {
  const [route] = await tx
    .select({ id: deploymentRoutes.id })
    .from(deploymentRoutes)
    .where(eq(deploymentRoutes.deploymentId, deploymentId))
    .limit(1);
  return route;
}

async function findStoppedRouteOwnerId(
  tx: DeploymentTransaction,
  candidate: SupersedeCandidateContext,
): Promise<string | undefined> {
  const [owner] = await tx
    .select({ deploymentId: deploymentRoutes.deploymentId })
    .from(deploymentRoutes)
    .innerJoin(deployments, eq(deploymentRoutes.deploymentId, deployments.id))
    .innerJoin(deploymentKubeReferences, eq(deploymentKubeReferences.deploymentId, deployments.id))
    .where(
      and(
        eq(deployments.environmentId, candidate.environmentId),
        eq(deployments.projectServiceId, candidate.serviceId),
        eq(deploymentKubeReferences.state, 'stopped'),
      ),
    )
    .orderBy(desc(deployments.createdAt), desc(deployments.id))
    .limit(1);
  return owner?.deploymentId;
}
