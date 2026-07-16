import type { ResourceReconcileRunState } from '../queries/resource-reconcile-runs.query.types';

export interface ResourceReconcileWaitContext {
  deadlineAt: number;
  nextQueueRefreshAt: number;
  predecessorToken: string | null;
  state: ResourceReconcileRunState | null;
}
