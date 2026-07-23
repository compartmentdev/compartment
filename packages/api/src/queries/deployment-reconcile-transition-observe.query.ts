import { and, desc, eq, ne } from 'drizzle-orm';
import { deploymentKubeReferences, deployments } from '../db/schema';
import type { SupersedeCandidateContext } from './deployment-reconcile-supersede.query';
import type { DeploymentTransaction } from './deployments.query.types';

export type DeploymentReferenceRow = Pick<typeof deploymentKubeReferences.$inferSelect, 'revision' | 'state'>;

export async function lockDeploymentReconcileReference(
  tx: DeploymentTransaction,
  deploymentId: string,
): Promise<DeploymentReferenceRow | undefined> {
  return (
    await tx
      .select({ revision: deploymentKubeReferences.revision, state: deploymentKubeReferences.state })
      .from(deploymentKubeReferences)
      .where(eq(deploymentKubeReferences.deploymentId, deploymentId))
      .for('update')
  )[0];
}

export async function findReconcileCandidate(
  tx: DeploymentTransaction,
  deploymentId: string,
): Promise<SupersedeCandidateContext | undefined> {
  return (
    await tx
      .select({
        deploymentRunId: deployments.deploymentRunId,
        environmentId: deployments.environmentId,
        isActive: deployments.isActive,
        serviceId: deployments.projectServiceId,
      })
      .from(deployments)
      .where(eq(deployments.id, deploymentId))
  )[0];
}

export async function findPreviousActiveId(
  tx: DeploymentTransaction,
  deploymentId: string,
  candidate: SupersedeCandidateContext,
): Promise<string | undefined> {
  const [previousActive] = await tx
    .select({ id: deployments.id })
    .from(deployments)
    .where(
      and(
        eq(deployments.environmentId, candidate.environmentId),
        eq(deployments.projectServiceId, candidate.serviceId),
        eq(deployments.isActive, true),
        ne(deployments.id, deploymentId),
      ),
    )
    .orderBy(desc(deployments.createdAt), desc(deployments.id))
    .limit(1);
  return previousActive?.id;
}
