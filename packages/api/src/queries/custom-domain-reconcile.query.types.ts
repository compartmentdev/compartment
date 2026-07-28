import type {
  CustomDomainState,
  WorkerFailCustomDomainReconcileRequest,
  WorkerObserveCustomDomainReconcileRequest,
} from '@compartment/contracts';

export interface CustomDomainDeletionTransition {
  deletionGeneration: number;
  previousGeneration: number;
  previousState: CustomDomainState;
}

export interface ClaimedCustomDomainReconcileRow {
  desiredGeneration: number;
  domainId: string;
  host: string;
  leaseId: string;
  operation: 'delete' | 'reconcile';
}

export interface CustomDomainReconcileLeaseRow {
  desiredGeneration: number;
  domainId: string;
  host: string;
  observedCertificatePresent: boolean;
  observedCertificateReady: boolean;
  observedGeneration: number;
  observedIngressPresent: boolean;
  operation: 'delete' | 'reconcile';
}

export type ObserveCustomDomainReconcileInput = WorkerObserveCustomDomainReconcileRequest;
export type FailCustomDomainReconcileInput = WorkerFailCustomDomainReconcileRequest;
