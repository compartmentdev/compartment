import type { TenantSecretEnvelope, WorkerAcknowledgeResourceReconcileRequest } from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';
import {
  decryptTenantVariableValueFromStorage,
  encryptTenantVariableValueForStorage,
  type EncryptedVariableValue,
} from '../lib/variables-crypto';
import { getApiConfig } from '../runtime/runtime-access';

export function decryptResourceRollbackManifest(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const parsed: JsonValue = JSON.parse(value) as JsonValue;
  if (Array.isArray(parsed)) {
    return value;
  }
  const envelope: TenantSecretEnvelope = readTenantSecretEnvelope(parsed);
  return decryptTenantVariableValueFromStorage(
    envelope.valueCiphertext,
    envelope.encryptionKeyId,
    getApiConfig().tenantSecretsKek,
    getApiConfig().tenantSecretsPreviousKek,
  );
}

export function encryptResourceRollbackAcknowledgement(
  input: WorkerAcknowledgeResourceReconcileRequest,
): WorkerAcknowledgeResourceReconcileRequest {
  return {
    ...input,
    ...(input.previousManifestJson === undefined
      ? {}
      : { previousManifestJson: encryptResourceRollbackManifest(input.previousManifestJson) }),
  };
}

function encryptResourceRollbackManifest(value: string): string {
  const encrypted: EncryptedVariableValue = encryptTenantVariableValueForStorage(
    value,
    getApiConfig().tenantSecretsKek,
    getApiConfig().variablesMasterKey,
  );
  return JSON.stringify({
    encryptionKeyId: encrypted.encryptionKeyId,
    valueCiphertext: encrypted.valueCiphertext,
  } satisfies TenantSecretEnvelope);
}

function readTenantSecretEnvelope(value: JsonValue): TenantSecretEnvelope {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    typeof value.encryptionKeyId !== 'string' ||
    typeof value.valueCiphertext !== 'string'
  ) {
    throw new Error('Persisted resource rollback manifest has an invalid envelope.');
  }
  return { encryptionKeyId: value.encryptionKeyId, valueCiphertext: value.valueCiphertext };
}
