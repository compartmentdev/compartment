import type { TenantSecretEnvelope } from '@compartment/contracts';
import type { StoredResourceEnvSource, StoredResourceOperationConfig } from './resources.service.storage';

export interface PersistedResourceEnvSource extends Omit<StoredResourceEnvSource, 'literalValue'> {
  literalValue: string | TenantSecretEnvelope | null;
}

export interface PersistedResourceOperationConfig extends Omit<StoredResourceOperationConfig, 'env'> {
  env: PersistedResourceEnvSource[];
}

export interface PersistedResourceOperationsConfig {
  backup: PersistedResourceOperationConfig | null;
  restore: PersistedResourceOperationConfig | null;
}
