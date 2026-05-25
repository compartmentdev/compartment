import type { SystemDomainPendingStatus } from '@compartment/contracts';
import type { SystemDomainMutationQueryResult, SystemDomainTransaction } from './system-domain.query.types';

export interface SystemDomainPendingStatusUpdateInput {
  expectedSetupVersion: number;
  failureCode: string | null;
  failureMessage: string | null;
  operationId: string;
  pendingStatus: SystemDomainPendingStatus;
}

export interface SystemDomainPendingCertificateInput {
  expectedSetupVersion: number;
  operationId: string;
  pendingCertificateMetadataJson: string;
}

export interface VerifiedSystemDomainPendingInput {
  expectedSetupVersion: number;
  operationId: string;
}

export type SystemDomainOperationTransaction = SystemDomainTransaction;

export type SystemDomainOperationQueryResult = SystemDomainMutationQueryResult;
