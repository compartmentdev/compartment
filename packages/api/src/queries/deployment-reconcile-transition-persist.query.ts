import { eq, sql } from 'drizzle-orm';
import { deploymentKubeReferences, deploymentRunEvents, deployments } from '../db/schema';
import { createId } from '../lib/tokens';
import { persistActiveDeploymentDrift } from './deployment-reconcile-transition-audit.query';
import { findPreviousActiveId, findReconcileCandidate } from './deployment-reconcile-transition-observe.query';
import { switchReadyDeploymentRoute } from './deployment-reconcile-route.query';
import {
  lockDeploymentRun,
  markReadyRunOperationsSucceeded,
  markRunOperationsFailed,
} from './deployment-reconcile-run-completion.query';
import {
  supersedePreviousKubeDeployment,
  type SupersedeCandidateContext,
} from './deployment-reconcile-supersede.query';
import type { DeploymentTransaction } from './deployments.query.types';
import type { PersistDeploymentReconcileObservationInput } from './deployment-reconcile.query.types';

type DeploymentReferenceState = 'active' | 'desired' | 'pending' | 'stopped' | 'stopping';

export async function persistPendingDeploymentObservation(
  tx: DeploymentTransaction,
  input: PersistDeploymentReconcileObservationInput,
  state: DeploymentReferenceState,
): Promise<boolean> {
  if (state === 'active') {
    await persistActiveDeploymentDrift(tx, input);
  }
  return await updateReference(tx, input, 'pending');
}

export async function persistFailedDeploymentObservation(
  tx: DeploymentTransaction,
  input: PersistDeploymentReconcileObservationInput,
  state: DeploymentReferenceState,
): Promise<boolean> {
  if (state === 'active') {
    return false;
  }
  const candidate: SupersedeCandidateContext | undefined = await findReconcileCandidate(tx, input.deploymentId);
  if (candidate?.isActive === true) {
    return await updateReference(tx, input, 'pending');
  }
  await markDeploymentFailed(tx, input);
  if (candidate !== undefined) {
    await lockDeploymentRun(tx, candidate.deploymentRunId);
    const failureMessage: string = input.failureMessage ?? 'Kubernetes rollout failed.';
    await markRunOperationsFailed(tx, candidate.deploymentRunId, input.observedAt, failureMessage);
  }
  return await updateReference(tx, input, 'pending');
}

export async function persistReadyDeploymentObservation(
  tx: DeploymentTransaction,
  input: PersistDeploymentReconcileObservationInput,
  state: DeploymentReferenceState,
): Promise<boolean> {
  if (state !== 'pending') {
    return false;
  }
  const candidate: SupersedeCandidateContext | undefined = await findReconcileCandidate(tx, input.deploymentId);
  if (candidate === undefined) {
    return false;
  }
  if (candidate.isActive) {
    return await updateReference(tx, input, 'active');
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
  state: 'pending' | 'active',
): Promise<true> {
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
  return true;
}
