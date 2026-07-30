import type { TenantSecretEnvironment, TenantSecretEnvelope } from '@compartment/contracts';
import { encryptAes256GcmEnvelope, type Aes256GcmEnvelopeCiphertext } from '@compartment/utils';
import type { TenantSecretsKeyring } from '../src/tenant-secret-environment.types';

export const testTenantSecretsKek: TenantSecretsKeyring = { current: Buffer.alloc(32, 1) };

export function encryptTestTenantEnvironment(environment: Readonly<Record<string, string>>): TenantSecretEnvironment {
  return Object.fromEntries(
    Object.entries(environment).map(([keyName, value]: [string, string]): [string, TenantSecretEnvelope] => {
      const encrypted: Aes256GcmEnvelopeCiphertext = encryptAes256GcmEnvelope(
        value,
        testTenantSecretsKek.current,
        'tenant-kek',
      );
      return [keyName, { encryptionKeyId: encrypted.keyId, valueCiphertext: encrypted.ciphertext }];
    }),
  );
}
