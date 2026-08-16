import {
  resourceReadinessTimeoutMaxMs,
  resourceReconcileLeaseHeartbeatIntervalMs,
  resourceReconcileLifecycleTimeoutMs,
} from '@compartment/contracts';
import {
  projectProvisioningAttemptLimit,
  projectProvisioningLeaseDurationMs,
  projectProvisioningRetryDelayMs,
} from './project-provisioning-policy';

export const resourceReconcileLeaseDurationMs: number = 10 * resourceReconcileLeaseHeartbeatIntervalMs;
export const resourceProductJobQueueBaseTimeoutMs: number = 30 * 60_000;

export function resourceReconcileOperationWaitTimeoutMs(
  operationType: 'bootstrap' | 'reconcile',
  infrastructureTimeoutMs: number,
): number {
  return operationType === 'bootstrap'
    ? resourceBootstrapWaitTimeoutMs()
    : resourceReconcileWaitTimeoutMs(infrastructureTimeoutMs);
}

export function resourceReconcilePredecessorWaitTimeoutMs(infrastructureTimeoutMs: number): number {
  return Math.max(resourceReconcileWaitTimeoutMs(infrastructureTimeoutMs), resourceBootstrapWaitTimeoutMs());
}

function resourceReconcileWaitTimeoutMs(infrastructureTimeoutMs: number): number {
  return (
    resourceReconcileLeaseDurationMs +
    2 * (resourceReconcileLifecycleTimeoutMs + 2 * infrastructureTimeoutMs + resourceReadinessTimeoutMaxMs) +
    30_000
  );
}

function resourceBootstrapWaitTimeoutMs(): number {
  const retryBudgetMs: number = (projectProvisioningAttemptLimit - 1) * projectProvisioningRetryDelayMs;
  return (
    projectProvisioningAttemptLimit * projectProvisioningLeaseDurationMs +
    retryBudgetMs +
    resourceReconcileLeaseDurationMs +
    resourceReconcileLifecycleTimeoutMs +
    30_000
  );
}
