export interface CustomDomainReconcileClaimTarget {
  desiredGeneration: number;
  domainId: string;
  host: string;
  operation: 'delete' | 'reconcile';
}

export interface CustomDomainReconcileClaimResult {
  leaseId: string | null;
  target: CustomDomainReconcileClaimTarget | null;
}

export interface CustomDomainReconcileMutationResult {
  applied: boolean;
}
