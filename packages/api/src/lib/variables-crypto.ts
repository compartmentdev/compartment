import { createHmac, hkdfSync } from 'node:crypto';
import {
  createAes256GcmKeyId,
  decryptAes256GcmEnvelope,
  encryptAes256GcmEnvelope,
  parseAes256GcmKey,
  rewrapAes256GcmEnvelope,
  type Aes256GcmEnvelopeCiphertext,
} from '@compartment/utils';

const aes256KeyBytes: number = 32;
const tenantSecretKeyIdNamespace: string = 'tenant-kek';
const legacyVariableKeyIdNamespace: string = 'install-kek';
const fingerprintContext: string = 'compartment:variables:fingerprint:v1';

export interface EncryptedVariableValue {
  encryptionKeyId: string;
  valueCiphertext: string;
  valueFingerprint: string;
}

export function parseVariablesMasterKey(value: string): Buffer {
  return parseAes256GcmKey(value, 'COMPARTMENT_VARIABLES_MASTER_KEY');
}

export function parseTenantSecretsKek(value: string): Buffer {
  return parseAes256GcmKey(value, 'COMPARTMENT_TENANT_SECRETS_KEK');
}

export function encryptVariableValueForStorage(plaintext: string, masterKey: Buffer): EncryptedVariableValue {
  return encryptStoredValue(plaintext, masterKey, masterKey, legacyVariableKeyIdNamespace);
}

export function encryptTenantVariableValueForStorage(
  plaintext: string,
  tenantSecretsKek: Buffer,
  fingerprintKey: Buffer,
): EncryptedVariableValue {
  return encryptStoredValue(plaintext, tenantSecretsKek, fingerprintKey, tenantSecretKeyIdNamespace);
}

function encryptStoredValue(
  plaintext: string,
  encryptionKey: Buffer,
  fingerprintKey: Buffer,
  keyIdNamespace: string,
): EncryptedVariableValue {
  const encrypted: Aes256GcmEnvelopeCiphertext = encryptAes256GcmEnvelope(plaintext, encryptionKey, keyIdNamespace);

  return {
    encryptionKeyId: encrypted.keyId,
    valueCiphertext: encrypted.ciphertext,
    valueFingerprint: createVariableValueFingerprint(plaintext, fingerprintKey),
  };
}

export function decryptVariableValueFromStorage(
  valueCiphertext: string,
  encryptionKeyId: string,
  masterKey: Buffer,
): string {
  assertEncryptionKeyId(encryptionKeyId, masterKey, legacyVariableKeyIdNamespace);
  return decryptAes256GcmEnvelope(valueCiphertext, masterKey);
}

export function decryptTenantVariableValueFromStorage(
  valueCiphertext: string,
  encryptionKeyId: string,
  tenantSecretsKek: Buffer,
  previousTenantSecretsKek?: Buffer,
): string {
  const sourceKek: Buffer | undefined = [tenantSecretsKek, previousTenantSecretsKek].find(
    (key: Buffer | undefined): key is Buffer => key !== undefined && supportsTenantSecretKeyId(encryptionKeyId, key),
  );
  if (sourceKek === undefined) {
    throw new Error(`Encrypted variable value uses unsupported key id "${encryptionKeyId}".`);
  }
  return decryptAes256GcmEnvelope(valueCiphertext, sourceKek);
}

export function rewrapVariableValueForStorage(
  valueCiphertext: string,
  encryptionKeyId: string,
  oldKek: Buffer,
  newKek: Buffer,
): Pick<EncryptedVariableValue, 'encryptionKeyId' | 'valueCiphertext'> {
  assertRewrapSourceKeyId(encryptionKeyId, oldKek);
  return {
    encryptionKeyId: tenantVariableEncryptionKeyId(newKek),
    valueCiphertext: rewrapAes256GcmEnvelope(valueCiphertext, oldKek, newKek),
  };
}

function assertEncryptionKeyId(encryptionKeyId: string, key: Buffer, namespace: string): void {
  const currentKeyId: string = createAes256GcmKeyId(key, namespace);
  if (encryptionKeyId !== currentKeyId) {
    throw new Error(
      `Encrypted variable value uses unsupported key id "${encryptionKeyId}" (current "${currentKeyId}").`,
    );
  }
}

function assertRewrapSourceKeyId(encryptionKeyId: string, key: Buffer): void {
  if (!supportsTenantSecretKeyId(encryptionKeyId, key)) {
    throw new Error(`Encrypted variable value uses unsupported key id "${encryptionKeyId}".`);
  }
}

function supportsTenantSecretKeyId(encryptionKeyId: string, key: Buffer): boolean {
  return (
    encryptionKeyId === tenantVariableEncryptionKeyId(key) || encryptionKeyId === legacyVariableEncryptionKeyId(key)
  );
}

export function tenantVariableEncryptionKeyId(masterKey: Buffer): string {
  return createAes256GcmKeyId(masterKey, tenantSecretKeyIdNamespace);
}

export function legacyVariableEncryptionKeyId(masterKey: Buffer): string {
  return createAes256GcmKeyId(masterKey, legacyVariableKeyIdNamespace);
}

export function createVariableValueFingerprint(plaintext: string, masterKey: Buffer): string {
  const fingerprintKey: Buffer = Buffer.from(
    hkdfSync('sha256', masterKey, Buffer.alloc(0), Buffer.from(fingerprintContext, 'utf8'), aes256KeyBytes),
  );

  return createHmac('sha256', fingerprintKey).update(plaintext, 'utf8').digest('hex');
}
