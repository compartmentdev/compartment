import type { TenantSecretEnvironment, TenantSecretEnvelope } from '@compartment/contracts';
import { createAes256GcmKeyId, decryptAes256GcmEnvelope } from '@compartment/utils';
import type { TenantSecretsKeyring } from './tenant-secret-environment.types';

const tenantSecretKeyIdNamespace: string = 'tenant-kek';
const platformRuntimeEnvironmentKeys: ReadonlySet<string> = new Set([
  'COMPARTMENT_ENVIRONMENT',
  'COMPARTMENT_PROJECT',
  'COMPARTMENT_SERVICE',
  'PORT',
]);

export function decryptTenantSecretEnvironment(
  environment: TenantSecretEnvironment,
  keyring: TenantSecretsKeyring,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).map(([keyName, envelope]: [string, TenantSecretEnvelope]): [string, string] => [
      keyName,
      decryptTenantSecretEnvelope(envelope, keyring),
    ]),
  );
}

export function redactTenantSecretValues(logs: string, environment: Record<string, string>): string {
  return Object.entries(environment).reduce(
    (redacted: string, [keyName, value]: [string, string]): string =>
      value === '' || platformRuntimeEnvironmentKeys.has(keyName) ? redacted : redacted.replaceAll(value, '[REDACTED]'),
    logs,
  );
}

function decryptTenantSecretEnvelope(envelope: TenantSecretEnvelope, keyring: TenantSecretsKeyring): string {
  const key: Buffer | undefined = [keyring.current, keyring.previous].find(
    (candidate: Buffer | undefined): candidate is Buffer =>
      candidate !== undefined &&
      envelope.encryptionKeyId === createAes256GcmKeyId(candidate, tenantSecretKeyIdNamespace),
  );
  if (key === undefined) {
    throw new Error(`Tenant secret envelope uses unsupported key id "${envelope.encryptionKeyId}".`);
  }
  return decryptAes256GcmEnvelope(envelope.valueCiphertext, key);
}
