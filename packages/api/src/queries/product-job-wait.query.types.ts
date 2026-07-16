export interface ProductJobQueueWaitRow {
  predecessorToken: string;
  productJobBudgetMs: number | string;
  resourceBootstrapPredecessorCount: number;
  resourceReconcilePredecessorCount: number;
}

export interface ProductJobQueueWaitState {
  predecessorToken: string;
  queueBudgetMs: number;
}
