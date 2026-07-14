import { and, eq, ne, type SQL } from 'drizzle-orm';
import { deploymentKubeReferences, deploymentRoutes, deploymentRunEvents, deployments, operations } from '../db/schema';
import { createId } from '../lib/tokens';
import { getApiDatabase } from '../runtime/runtime-access';
import { persistActiveDeploymentDrift } from './deployment-reconcile-transition-audit.query';
import { persistStoppedReconcileObservation } from './deployment-reconcile-stop.query';
import type { DeploymentTransaction } from './deployments.query.types';
import type { PersistDeploymentReconcileObservationInput } from './deployment-reconcile.query.types';

interface CandidateContext {
  deploymentRunId: string;
  environmentId: string;
  serviceId: string;
}

interface ReconcileReferenceRow {
  revision: number;
  state: 'active' | 'desired' | 'pending' | 'stopping' | 'stopped';
}

export async function persistDeploymentReconcileObservation(
  input: PersistDeploymentReconcileObservationInput,
): Promise<boolean> {
  return await getApiDatabase().transaction(
    async (tx: DeploymentTransaction): Promise<boolean> => await persistObservationWithTransaction(tx, input),
  );
}

async function persistObservationWithTransaction(
  tx: DeploymentTransaction,
  input: PersistDeploymentReconcileObservationInput,
): Promise<boolean> {
  const [reference] = await lockReference(tx, input.deploymentId);
  if (reference?.revision !== input.revision) {
    return false;
  }
  if (input.observation === 'pending') {
    return await persistPendingObservation(tx, input, reference.state);
  }
  if (input.observation === 'failed') {
    return await persistFailure(tx, input, reference.state);
  }
  if (input.observation === 'stopped') {
    return await persistStoppedReconcileObservation(tx, input, reference.state);
  }
  return await persistReady(tx, input, reference.state);
}

async function lockReference(tx: DeploymentTransaction, deploymentId: string): Promise<ReconcileReferenceRow[]> {
  return await tx
    .select({ revision: deploymentKubeReferences.revision, state: deploymentKubeReferences.state })
    .from(deploymentKubeReferences)
    .where(eq(deploymentKubeReferences.deploymentId, deploymentId))
    .for('update');
}

async function persistPendingObservation(
  tx: DeploymentTransaction,
  input: PersistDeploymentReconcileObservationInput,
  state: 'active' | 'desired' | 'pending' | 'stopping' | 'stopped',
): Promise<boolean> {
  if (state === 'active') {
    await persistActiveDeploymentDrift(tx, input);
  }
  await updateReference(tx, input, 'pending');
  return true;
}

async function persistFailure(
  tx: DeploymentTransaction,
  input: PersistDeploymentReconcileObservationInput,
  state: string,
): Promise<boolean> {
  if (state === 'active') {
    return false;
  }
  await markDeploymentFailed(tx, input);
  await markOperationFailed(tx, input);
  await updateReference(tx, input, 'pending');
  return true;
}

async function markDeploymentFailed(
  tx: DeploymentTransaction,
  input: PersistDeploymentReconcileObservationInput,
): Promise<void> {
  await tx
    .update(deployments)
    .set({
      completedAt: input.observedAt,
      failureMessage: input.failureMessage,
      health: 'unhealthy',
      status: 'failed',
      updatedAt: input.observedAt,
    })
    .where(eq(deployments.id, input.deploymentId));
}

async function markOperationFailed(
  tx: DeploymentTransaction,
  input: PersistDeploymentReconcileObservationInput,
): Promise<void> {
  await tx
    .update(operations)
    .set({
      completedAt: input.observedAt,
      status: 'failed',
      summary: input.failureMessage ?? 'Kubernetes rollout failed.',
    })
    .where(eq(operations.targetId, input.deploymentId));
}

async function persistReady(
  tx: DeploymentTransaction,
  input: PersistDeploymentReconcileObservationInput,
  state: string,
): Promise<boolean> {
  if (state !== 'pending') {
    return false;
  }
  const candidate: CandidateContext | undefined = await findCandidateContext(tx, input.deploymentId);
  if (candidate === undefined) {
    return false;
  }
  const previousActiveId: string | undefined = await findPreviousActiveId(tx, input.deploymentId, candidate);
  await deactivatePreviousDeployments(tx, input, candidate);
  await activateDeployment(tx, input);
  await switchReconcileRoute(tx, input, previousActiveId);
  await publishReconcileSucceeded(tx, input, candidate.deploymentRunId);
  await updateReference(tx, input, 'active');
  return true;
}

async function findCandidateContext(
  tx: DeploymentTransaction,
  deploymentId: string,
): Promise<CandidateContext | undefined> {
  const [candidate] = await tx
    .select({
      deploymentRunId: deployments.deploymentRunId,
      environmentId: deployments.environmentId,
      serviceId: deployments.projectServiceId,
    })
    .from(deployments)
    .where(eq(deployments.id, deploymentId));
  return candidate;
}

async function publishReconcileSucceeded(
  tx: DeploymentTransaction,
  input: PersistDeploymentReconcileObservationInput,
  deploymentRunId: string,
): Promise<void> {
  await markReconcileOperationSucceeded(tx, input);
  await tx.insert(deploymentRunEvents).values({
    createdAt: input.observedAt,
    deploymentId: input.deploymentId,
    deploymentRunId,
    id: createId('drev'),
    level: 'info',
    message: 'deployment completed',
    status: 'succeeded',
    stepKey: 'completed',
    stream: 'compartment',
  });
}

async function findPreviousActiveId(
  tx: DeploymentTransaction,
  deploymentId: string,
  candidate: CandidateContext,
): Promise<string | undefined> {
  const [previousActive] = await tx
    .select({ id: deployments.id })
    .from(deployments)
    .where(activeDeploymentFilter(deploymentId, candidate))
    .limit(1);
  return previousActive?.id;
}

async function deactivatePreviousDeployments(
  tx: DeploymentTransaction,
  input: PersistDeploymentReconcileObservationInput,
  candidate: CandidateContext,
): Promise<void> {
  await tx
    .update(deployments)
    .set({ isActive: false, updatedAt: input.observedAt })
    .where(activeDeploymentFilter(input.deploymentId, candidate));
}

function activeDeploymentFilter(deploymentId: string, candidate: CandidateContext): SQL | undefined {
  return and(
    eq(deployments.environmentId, candidate.environmentId),
    eq(deployments.projectServiceId, candidate.serviceId),
    eq(deployments.isActive, true),
    ne(deployments.id, deploymentId),
  );
}

async function activateDeployment(
  tx: DeploymentTransaction,
  input: PersistDeploymentReconcileObservationInput,
): Promise<void> {
  await tx
    .update(deployments)
    .set({
      completedAt: input.observedAt,
      failureMessage: null,
      health: 'healthy',
      isActive: true,
      promotionStage: 'active',
      status: 'succeeded',
      upstreamHost: null,
      upstreamPort: null,
      updatedAt: input.observedAt,
    })
    .where(eq(deployments.id, input.deploymentId));
}

async function switchReconcileRoute(
  tx: DeploymentTransaction,
  input: PersistDeploymentReconcileObservationInput,
  previousActiveId: string | undefined,
): Promise<void> {
  if (previousActiveId !== undefined) {
    await tx
      .update(deploymentRoutes)
      .set({ deploymentId: input.deploymentId, updatedAt: input.observedAt })
      .where(eq(deploymentRoutes.deploymentId, previousActiveId));
  }
}

async function markReconcileOperationSucceeded(
  tx: DeploymentTransaction,
  input: PersistDeploymentReconcileObservationInput,
): Promise<void> {
  await tx
    .update(operations)
    .set({
      completedAt: input.observedAt,
      status: 'succeeded',
      summary: `Deployment ${input.deploymentId} is active in Kubernetes`,
    })
    .where(eq(operations.targetId, input.deploymentId));
}

async function updateReference(
  tx: DeploymentTransaction,
  input: PersistDeploymentReconcileObservationInput,
  state: 'pending' | 'active' | 'stopped',
): Promise<void> {
  await tx
    .update(deploymentKubeReferences)
    .set({
      observedAt: input.observedAt,
      revision: input.revision + 1,
      state,
      transitionedAt: input.observedAt,
      updatedAt: input.observedAt,
    })
    .where(eq(deploymentKubeReferences.deploymentId, input.deploymentId));
}
