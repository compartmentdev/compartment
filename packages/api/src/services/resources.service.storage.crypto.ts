import type { TenantSecretEnvelope } from '@compartment/contracts';
import {
  decryptTenantVariableValueFromStorage,
  encryptTenantVariableValueForStorage,
  type EncryptedVariableValue,
} from '../lib/variables-crypto';
import { getApiConfig } from '../runtime/runtime-access';
import type { StoredResourceEnvSource, StoredResourceOperationConfig } from './resources.service.storage';
import type { PersistedResourceEnvSource, PersistedResourceOperationConfig } from './resources.service.storage.types';

export function encryptResourceOperation(
  operation: StoredResourceOperationConfig | null,
): PersistedResourceOperationConfig | null {
  return operation === null ? null : { ...operation, env: encryptResourceEnv(operation.env) };
}

export function decryptResourceOperation(
  operation: PersistedResourceOperationConfig | null | undefined,
): StoredResourceOperationConfig | null {
  if (operation === null || operation === undefined) {
    return null;
  }
  return {
    ...operation,
    env: decryptResourceEnv(operation.env),
    schedule: operation.schedule ?? null,
  };
}

export function encryptResourceEnv(env: StoredResourceEnvSource[]): PersistedResourceEnvSource[] {
  return env.map(
    (source: StoredResourceEnvSource): PersistedResourceEnvSource => ({
      ...source,
      literalValue: source.literalValue === null ? null : encryptResourceLiteral(source.literalValue),
    }),
  );
}

export function decryptResourceEnv(env: PersistedResourceEnvSource[]): StoredResourceEnvSource[] {
  return env.map(
    (source: PersistedResourceEnvSource): StoredResourceEnvSource => ({
      ...source,
      literalValue: decryptResourceLiteral(source.literalValue),
    }),
  );
}

function encryptResourceLiteral(value: string): TenantSecretEnvelope {
  const encrypted: EncryptedVariableValue = encryptTenantVariableValueForStorage(
    value,
    getApiConfig().tenantSecretsKek,
    getApiConfig().variablesMasterKey,
  );
  return {
    encryptionKeyId: encrypted.encryptionKeyId,
    valueCiphertext: encrypted.valueCiphertext,
  };
}

function decryptResourceLiteral(value: string | TenantSecretEnvelope | null): string | null {
  if (value === null || typeof value === 'string') {
    return value;
  }
  return decryptTenantVariableValueFromStorage(
    value.valueCiphertext,
    value.encryptionKeyId,
    getApiConfig().tenantSecretsKek,
    getApiConfig().tenantSecretsPreviousKek,
  );
}
