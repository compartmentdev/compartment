import type { TenantSecretEnvironment, TenantSecretEnvelope } from '@compartment/contracts';
import { encryptTenantVariableValueForStorage, type EncryptedVariableValue } from '../lib/variables-crypto';
import { getApiConfig } from '../runtime/runtime-access';

export function encryptTenantSecretEnvironment(environment: Readonly<Record<string, string>>): TenantSecretEnvironment {
  return Object.fromEntries(
    Object.entries(environment).map(([keyName, value]: [string, string]): [string, TenantSecretEnvelope] => [
      keyName,
      tenantSecretEnvelope(value),
    ]),
  );
}

function tenantSecretEnvelope(value: string): TenantSecretEnvelope {
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
