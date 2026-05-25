import type { ApiDatabaseTransaction } from '../db/client.types';

export interface SystemDomainSetupStateRow {
  createdAt: Date;
  setupVersion: number;
  id: string;
  pendingBaseDomain: string | null;
  pendingCaddyMode: string | null;
  pendingCertificateMetadataJson: string | null;
  pendingCertificatePath: string | null;
  pendingDomainKind: string | null;
  pendingFailureCode: string | null;
  pendingFailureMessage: string | null;
  pendingOperationId: string | null;
  pendingPrivateKeyPath: string | null;
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
  pendingCaddyMode: string;
  pendingDomainKind: string;
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
