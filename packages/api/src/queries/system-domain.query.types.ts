import type { ApiDatabaseTransaction } from '../db/client.types';

export interface SystemDomainSetupStateRow {
  createdAt: Date;
  setupVersion: number;
  id: string;
  pendingBaseDomain: string | null;
  pendingCertificateMetadataJson: string | null;
  pendingTlsSecretName: string | null;
  pendingDomainKind: string | null;
  pendingIssuerRefJson: string | null;
  pendingFailureCode: string | null;
  pendingFailureMessage: string | null;
  pendingOperationId: string | null;
  pendingPublicScheme: string | null;
  pendingRequiredDnsRecordsJson: string | null;
  pendingStatus: string | null;
  pendingTlsMode: string | null;
  updatedAt: Date;
}

export interface SystemDomainIdempotencyKeyRow {
  createdAt: Date;
  id: string;
  idempotencyKey: string;
  requestHash: string;
  responseJson: string;
}

export interface StoreSystemDomainIdempotencyKeyInput {
  id: string;
  idempotencyKey: string;
  requestHash: string;
  responseJson: string;
}

export interface StageSystemDomainPendingInput {
  expectedSetupVersion: number;
  operationId: string;
  pendingBaseDomain: string;
  pendingDomainKind: string;
  pendingIssuerRefJson: string | null;
  pendingPublicScheme: string;
  pendingRequiredDnsRecordsJson: string;
  pendingTlsMode: string;
}

export interface VersionedSetupInput {
  expectedSetupVersion: number;
}

export interface ClearSystemDomainPendingInput extends VersionedSetupInput {
  operationId: string;
}

export type SystemDomainTransaction = ApiDatabaseTransaction;

export interface SystemDomainMutationQueryResult {
  operationId: string;
  setupState: SystemDomainSetupStateRow;
}
