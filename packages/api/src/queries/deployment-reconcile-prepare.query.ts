import { eq } from 'drizzle-orm';
import { buildArtifacts, deploymentKubeReferences, deployments } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { ensureDeploymentRouteWithExecutor } from './deployment-route-persistence.query';
import type { DeploymentTransaction } from './deployments.query.types';
import {
  buildDeploymentKubeReferenceValues,
  type DeploymentKubeReferenceValues,
} from './deployment-kube-reference-values';
import type { PrepareDeploymentReconcileInput, PrepareDeploymentRow } from './deployment-reconcile.query.types';

export async function prepareDeploymentReconcileReference(input: PrepareDeploymentReconcileInput): Promise<void> {
  await getApiDatabase().transaction(
    async (tx: DeploymentTransaction): Promise<void> => await prepareWithTransaction(tx, input),
  );
}

async function prepareWithTransaction(
  tx: DeploymentTransaction,
  input: PrepareDeploymentReconcileInput,
): Promise<void> {
  const deployment: PrepareDeploymentRow = await lockPrepareDeployment(tx, input.deploymentId);
  const now: Date = new Date();
  await updateBuildArtifact(tx, input, deployment, now);
  await insertDesiredReference(tx, input, now);
  await upsertPreparedRoute(tx, input, deployment, now);
}

async function updateBuildArtifact(
  tx: DeploymentTransaction,
  input: PrepareDeploymentReconcileInput,
  deployment: PrepareDeploymentRow,
  now: Date,
): Promise<void> {
  await tx
    .update(buildArtifacts)
    .set({ imageCleanedAt: null, imageRef: input.imageRef, imageRetentionState: 'available', updatedAt: now })
    .where(eq(buildArtifacts.id, deployment.buildArtifactId));
}

async function insertDesiredReference(
  tx: DeploymentTransaction,
  input: PrepareDeploymentReconcileInput,
  now: Date,
): Promise<void> {
  const values: DeploymentKubeReferenceValues = buildDeploymentKubeReferenceValues(input, now);
  await tx
    .insert(deploymentKubeReferences)
    .values(values)
    .onConflictDoNothing({ target: deploymentKubeReferences.deploymentId });
}

async function upsertPreparedRoute(
  tx: DeploymentTransaction,
  input: PrepareDeploymentReconcileInput,
  deployment: PrepareDeploymentRow,
  now: Date,
): Promise<void> {
  await ensureDeploymentRouteWithExecutor(tx, {
    accessScopeId: deployment.environmentId,
    accessScopeType: 'environment',
    deploymentId: input.deploymentId,
    environmentId: deployment.environmentId,
    id: input.routeId,
    serviceId: deployment.serviceId,
    subdomain: input.routeSubdomain,
    updatedAt: now,
  });
}

async function lockPrepareDeployment(tx: DeploymentTransaction, deploymentId: string): Promise<PrepareDeploymentRow> {
  const [deployment] = await tx
    .select({
      buildArtifactId: deployments.buildArtifactId,
      environmentId: deployments.environmentId,
      serviceId: deployments.projectServiceId,
    })
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .for('update');
  if (deployment === undefined) {
    throw new Error(`Deployment ${deploymentId} was not found.`);
  }
  return deployment;
}
