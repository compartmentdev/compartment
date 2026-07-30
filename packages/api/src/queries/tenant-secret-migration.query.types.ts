import type { ApiDatabaseTransaction } from '../db/client.types';

export type TenantSecretStorage = 'environment_variable_values' | 'organization_variable_set_entries';
export type TenantSecretJsonStorage =
  | 'build_artifacts'
  | 'project_resources_env'
  | 'project_resources_operations'
  | 'product_job_runs'
  | 'resource_backups'
  | 'resource_reconcile_rollbacks'
  | 'resource_reconcile_runs';

export interface PersistedTenantSecretRow {
  encryptionKeyId: string;
  id: string;
  valueCiphertext: string;
}

export interface TenantSecretStorageRow extends PersistedTenantSecretRow {
  storage: TenantSecretStorage;
}

export interface TenantSecretJsonStorageRow {
  id: string;
  json: string;
  storage: TenantSecretJsonStorage;
}

export interface PersistedTenantSecretJsonRow {
  id: string;
  json: string;
}

export type TenantSecretStorageUpdate = TenantSecretStorageRow;

export type TenantSecretMigrationExecutor = ApiDatabaseTransaction;
