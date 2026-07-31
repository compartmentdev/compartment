import { getApiDatabase } from '../runtime/runtime-access';
import {
  lockDeploymentReconcileReference,
  type DeploymentReferenceRow,
} from './deployment-reconcile-transition-observe.query';
import {
  persistFailedDeploymentObservation,
  persistPendingDeploymentObservation,
  persistReadyDeploymentObservation,
} from './deployment-reconcile-transition-persist.query';
import { persistStoppedReconcileObservation } from './deployment-reconcile-stop.query';
import type { DeploymentTransaction } from './deployments.query.types';
import type {
  HandleCommittedDeploymentAuditEvents,
  PersistDeploymentReconcileObservationInput,
  PersistDeploymentReconcileObservationResult,
} from './deployment-reconcile.query.types';

export async function persistDeploymentReconcileObservation(
  input: PersistDeploymentReconcileObservationInput,
  handleCommittedAuditEvents?: HandleCommittedDeploymentAuditEvents,
): Promise<boolean> {
  const result: PersistDeploymentReconcileObservationResult =
    await persistDeploymentReconcileObservationWithAuditEvents(input);
  handleCommittedAuditEvents?.(result.auditEvents);
  return result.applied;
}

async function persistDeploymentReconcileObservationWithAuditEvents(
  input: PersistDeploymentReconcileObservationInput,
): Promise<PersistDeploymentReconcileObservationResult> {
  return await getApiDatabase().transaction(
    async (tx: DeploymentTransaction): Promise<PersistDeploymentReconcileObservationResult> =>
      await persistObservationWithTransaction(tx, input),
  );
}

async function persistObservationWithTransaction(
  tx: DeploymentTransaction,
  input: PersistDeploymentReconcileObservationInput,
): Promise<PersistDeploymentReconcileObservationResult> {
  const reference: DeploymentReferenceRow | undefined = await lockDeploymentReconcileReference(tx, input.deploymentId);
  if (
    reference === undefined ||
    (reference.revision !== input.revision && (input.observation !== 'pending' || reference.state !== 'desired'))
  ) {
    return { applied: false, auditEvents: [] };
  }
  if (input.observation === 'pending') {
    return { applied: await persistPendingDeploymentObservation(tx, input, reference.state), auditEvents: [] };
  }
  if (input.observation === 'failed') {
    return { applied: await persistFailedDeploymentObservation(tx, input, reference.state), auditEvents: [] };
  }
  if (input.observation === 'stopped') {
    return { applied: await persistStoppedReconcileObservation(tx, input, reference.state), auditEvents: [] };
  }
  return await persistReadyDeploymentObservation(tx, input, reference.state);
}
