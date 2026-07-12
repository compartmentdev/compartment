import { eq } from 'drizzle-orm';
import { deploymentKubeReferences } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { insertAuditEventWithExecutor } from './audit-events.query';
import {
  buildDeploymentKubeReferenceValues,
  type DeploymentKubeReferenceValues,
} from './deployment-kube-reference-values';
import type {
  DeploymentKubeState,
  DeploymentKubeTransitionTransaction,
  PersistDeploymentKubeTransitionInput,
  UpsertDeploymentKubeReferenceInput,
} from './deployment-kube-reference.query.types';

interface LockedReference {
  revision: number;
  state: DeploymentKubeState;
}

export async function upsertDeploymentKubeReference(input: UpsertDeploymentKubeReferenceInput): Promise<void> {
  const now: Date = new Date();
  const values: DeploymentKubeReferenceValues = buildDeploymentKubeReferenceValues(input, now);
  await getApiDatabase()
    .insert(deploymentKubeReferences)
    .values(values)
    .onConflictDoNothing({ target: deploymentKubeReferences.deploymentId });
}

export async function persistDeploymentKubeTransition(input: PersistDeploymentKubeTransitionInput): Promise<boolean> {
  return await getApiDatabase().transaction(
    async (transaction: DeploymentKubeTransitionTransaction): Promise<boolean> =>
      await persistTransitionWithTransaction(transaction, input),
  );
}

async function persistTransitionWithTransaction(
  transaction: DeploymentKubeTransitionTransaction,
  input: PersistDeploymentKubeTransitionInput,
): Promise<boolean> {
  const current: LockedReference | undefined = await lockReference(transaction, input);
  if (current === undefined) {
    throw new Error(`Missing Kubernetes reference for deployment ${input.deploymentId}.`);
  }
  if (input.expectedRevision !== current.revision) {
    return false;
  }
  assertValidTransition(current.state, input);
  await transaction
    .update(deploymentKubeReferences)
    .set({
      observedAt: input.observedAt,
      revision: current.revision + 1,
      state: input.nextState,
      transitionedAt: input.eventAt,
      updatedAt: new Date(),
    })
    .where(eq(deploymentKubeReferences.deploymentId, input.deploymentId));
  await insertActiveDriftAudit(transaction, input, current.state);
  return true;
}

async function lockReference(
  transaction: DeploymentKubeTransitionTransaction,
  input: PersistDeploymentKubeTransitionInput,
): Promise<LockedReference | undefined> {
  const [current] = await transaction
    .select({ revision: deploymentKubeReferences.revision, state: deploymentKubeReferences.state })
    .from(deploymentKubeReferences)
    .where(eq(deploymentKubeReferences.deploymentId, input.deploymentId))
    .for('update');
  return current;
}

async function insertActiveDriftAudit(
  transaction: DeploymentKubeTransitionTransaction,
  input: PersistDeploymentKubeTransitionInput,
  state: DeploymentKubeState,
): Promise<void> {
  if (input.audit !== null && state === 'active') {
    await insertKubeDriftAudit(transaction, input);
  }
}

async function insertKubeDriftAudit(
  transaction: DeploymentKubeTransitionTransaction,
  input: PersistDeploymentKubeTransitionInput,
): Promise<void> {
  if (input.audit === null) {
    return;
  }
  await insertAuditEventWithExecutor(transaction, {
    actorType: 'system',
    environmentId: input.environmentId,
    eventType: 'deployment.kubernetes.drift_detected',
    occurredAt: input.eventAt,
    metadata: { driftKind: input.audit.kind, message: input.audit.message },
    organizationId: input.organizationId,
    projectId: input.projectId,
    projectServiceId: input.projectServiceId,
    scopeType: 'organization',
    status: 'succeeded',
    targetId: input.deploymentId,
    targetType: 'deployment',
  });
}

function assertValidTransition(currentState: DeploymentKubeState, input: PersistDeploymentKubeTransitionInput): void {
  const validEdge: boolean =
    (currentState === 'desired' && input.nextState === 'pending') ||
    (currentState === 'pending' && (input.nextState === 'pending' || input.nextState === 'active')) ||
    (currentState === 'active' && (input.nextState === 'active' || input.nextState === 'pending'));
  const requiresAudit: boolean = currentState === 'active' && input.nextState === 'pending';
  if (!validEdge) {
    throw new Error(`Invalid Kubernetes deployment transition ${currentState} -> ${input.nextState}.`);
  }
  if (requiresAudit !== (input.audit !== null)) {
    throw new Error(`Kubernetes deployment transition ${currentState} -> ${input.nextState} has invalid drift audit.`);
  }
}
