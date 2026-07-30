import { createInvalidDeployConfigError } from '../errors/api-business-error';
import { decryptTenantVariableValueFromStorage } from '../lib/variables-crypto';
import { getApiConfig } from '../runtime/runtime-access';
import type { StoredEffectiveVariable } from './effective-variables.service.types';

export function decryptRequiredStoredValue(variable: StoredEffectiveVariable): string {
  if (variable.valueCiphertext === null || variable.encryptionKeyId === null) {
    throw createInvalidDeployConfigError(`Variable "${variable.keyName}" has no stored value.`);
  }
  try {
    return decryptTenantVariableValueFromStorage(
      variable.valueCiphertext,
      variable.encryptionKeyId,
      getApiConfig().tenantSecretsKek,
      getApiConfig().tenantSecretsPreviousKek,
    );
  } catch (error) {
    throw createInvalidDeployConfigError(`Variable "${variable.keyName}" cannot be decrypted.`, { cause: error });
  }
}
