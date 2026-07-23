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
import type { PersistDeploymentReconcileObservationInput } from './deployment-reconcile.query.types';

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
  const reference: DeploymentReferenceRow | undefined = await lockDeploymentReconcileReference(tx, input.deploymentId);
  if (
    reference === undefined ||
    (reference.revision !== input.revision && (input.observation !== 'pending' || reference.state !== 'desired'))
  ) {
    return false;
  }
  if (input.observation === 'pending') {
    return await persistPendingDeploymentObservation(tx, input, reference.state);
  }
  if (input.observation === 'failed') {
    return await persistFailedDeploymentObservation(tx, input, reference.state);
  }
  if (input.observation === 'stopped') {
    return await persistStoppedReconcileObservation(tx, input, reference.state);
  }
  return await persistReadyDeploymentObservation(tx, input, reference.state);
}
