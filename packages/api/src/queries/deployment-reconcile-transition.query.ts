import { and, desc, eq, ne, sql, type SQL } from 'drizzle-orm';
import { deploymentKubeReferences, deploymentRunEvents, deployments } from '../db/schema';
import { createId } from '../lib/tokens';
import { getApiDatabase } from '../runtime/runtime-access';
import { persistActiveDeploymentDrift } from './deployment-reconcile-transition-audit.query';
import { switchReadyDeploymentRoute } from './deployment-reconcile-route.query';
import {
  lockDeploymentRun,
  markReadyRunOperationsSucceeded,
  markRunOperationsFailed,
} from './deployment-reconcile-run-completion.query';
import { persistStoppedReconcileObservation } from './deployment-reconcile-stop.query';
import {
  supersedePreviousKubeDeployment,
  type SupersedeCandidateContext,
} from './deployment-reconcile-supersede.query';
import type { DeploymentTransaction } from './deployments.query.types';
import type { PersistDeploymentReconcileObservationInput } from './deployment-reconcile.query.types';

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
  if (
    reference === undefined ||
    (reference.revision !== input.revision && (input.observation !== 'pending' || reference.state !== 'desired'))
  ) {
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
  const candidate: SupersedeCandidateContext | undefined = await findCandidateContext(tx, input.deploymentId);
  if (candidate?.isActive === true) {
    await updateReference(tx, input, 'pending');
    return true;
  }
  await markDeploymentRunFailed(tx, input, candidate);
  await updateReference(tx, input, 'pending');
  return true;
}

async function markDeploymentRunFailed(
  tx: DeploymentTransaction,
  input: PersistDeploymentReconcileObservationInput,
  candidate: SupersedeCandidateContext | undefined,
): Promise<void> {
  await markDeploymentFailed(tx, input);
  if (candidate === undefined) {
    return;
  }
  await lockDeploymentRun(tx, candidate.deploymentRunId);
  await markRunOperationsFailed(
    tx,
    candidate.deploymentRunId,
    input.observedAt,
    input.failureMessage ?? 'Kubernetes rollout failed.',
  );
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

async function persistReady(
  tx: DeploymentTransaction,
  input: PersistDeploymentReconcileObservationInput,
  state: string,
): Promise<boolean> {
  if (state !== 'pending') {
    return false;
  }
  const candidate: SupersedeCandidateContext | undefined = await findCandidateContext(tx, input.deploymentId);
  if (candidate === undefined) {
    return false;
  }
  if (candidate.isActive) {
    await updateReference(tx, input, 'active');
    return true;
  }
  await promoteReadyCandidate(tx, input, candidate);
  return true;
}

async function promoteReadyCandidate(
  tx: DeploymentTransaction,
  input: PersistDeploymentReconcileObservationInput,
  candidate: SupersedeCandidateContext,
): Promise<void> {
  await lockDeploymentRun(tx, candidate.deploymentRunId);
  const previousActiveId: string | undefined = await findPreviousActiveId(tx, input.deploymentId, candidate);
  await supersedePreviousKubeDeployment(tx, {
    candidate,
    currentDeploymentId: input.deploymentId,
    observedAt: input.observedAt,
    previousActiveId,
  });
  await activateDeployment(tx, input);
  await switchReadyDeploymentRoute(tx, input, candidate, previousActiveId);
  await publishReconcileSucceeded(tx, input, candidate.deploymentRunId);
  await updateReference(tx, input, 'active');
}

async function findCandidateContext(
  tx: DeploymentTransaction,
  deploymentId: string,
): Promise<SupersedeCandidateContext | undefined> {
  const [candidate] = await tx
    .select({
      deploymentRunId: deployments.deploymentRunId,
      environmentId: deployments.environmentId,
      isActive: deployments.isActive,
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
  await markReadyRunOperationsSucceeded(tx, deploymentRunId);
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
  candidate: SupersedeCandidateContext,
): Promise<string | undefined> {
  const [previousActive] = await tx
    .select({ id: deployments.id })
    .from(deployments)
    .where(activeDeploymentFilter(deploymentId, candidate))
    .orderBy(desc(deployments.createdAt), desc(deployments.id))
    .limit(1);
  return previousActive?.id;
}

function activeDeploymentFilter(deploymentId: string, candidate: SupersedeCandidateContext): SQL | undefined {
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
      updatedAt: input.observedAt,
    })
    .where(eq(deployments.id, input.deploymentId));
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
      revision: sql`${deploymentKubeReferences.revision} + 1`,
      state,
      transitionedAt: input.observedAt,
      updatedAt: input.observedAt,
    })
    .where(eq(deploymentKubeReferences.deploymentId, input.deploymentId));
}
