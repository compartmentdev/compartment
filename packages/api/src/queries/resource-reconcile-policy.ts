import { resourceReadinessTimeoutMaxMs, resourceReconcileLifecycleTimeoutMs } from '@compartment/contracts';
import {
  projectProvisioningAttemptLimit,
  projectProvisioningLeaseDurationMs,
  projectProvisioningRetryDelayMs,
} from './project-provisioning-policy';

export const resourceReconcileLeaseDurationMs: number = 10 * 60_000;
export const resourceProductJobQueueBaseTimeoutMs: number = 30 * 60_000;

export function resourceReconcileOperationWaitTimeoutMs(operationType: 'bootstrap' | 'reconcile'): number {
  return operationType === 'bootstrap' ? resourceBootstrapWaitTimeoutMs() : resourceReconcileWaitTimeoutMs();
}

export function resourceReconcilePredecessorWaitTimeoutMs(): number {
  return Math.max(resourceReconcileWaitTimeoutMs(), resourceBootstrapWaitTimeoutMs());
}

function resourceReconcileWaitTimeoutMs(): number {
  return (
    resourceReconcileLeaseDurationMs +
    2 * (resourceReconcileLifecycleTimeoutMs + resourceReadinessTimeoutMaxMs) +
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
