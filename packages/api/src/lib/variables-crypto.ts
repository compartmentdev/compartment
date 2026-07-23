import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  type CipherGCM,
  type CipherGCMOptions,
  type CipherGCMTypes,
  type DecipherGCM,
} from 'node:crypto';
import { hasText } from '@compartment/utils';

const aes256KeyBytes: number = 32;
const aes256GcmAlgorithm: CipherGCMTypes = 'aes-256-gcm';
const aes256GcmAuthTagBytes: number = 16;
const aes256GcmIvBytes: number = 12;
const aes256GcmOptions: CipherGCMOptions = {
  authTagLength: aes256GcmAuthTagBytes,
};
const encryptionKeyIdPrefix: string = 'install-kek-sha256:';
const fingerprintContext: string = 'compartment:variables:fingerprint:v1';

interface EncryptedPayload {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
}

interface ParsedVariableCiphertextEnvelope {
  algorithm?: string;
  ciphertext?: string;
  dekWrapIv?: string;
  dekWrapTag?: string;
  valueIv?: string;
  valueTag?: string;
  version?: number;
  wrappedDek?: string;
}

interface VariableCiphertextEnvelopeV1 {
  algorithm: 'aes-256-gcm';
  ciphertext: string;
  dekWrapIv: string;
  dekWrapTag: string;
  valueIv: string;
  valueTag: string;
  version: 1;
  wrappedDek: string;
}

export interface EncryptedVariableValue {
  encryptionKeyId: string;
  valueCiphertext: string;
  valueFingerprint: string;
}

export function parseVariablesMasterKey(value: string): Buffer {
  if (!hasText(value) || !/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error('COMPARTMENT_VARIABLES_MASTER_KEY must be exactly 64 hex characters.');
  }

  return Buffer.from(value, 'hex');
}

export function encryptVariableValueForStorage(plaintext: string, masterKey: Buffer): EncryptedVariableValue {
  const dek: Buffer = randomBytes(aes256KeyBytes);
  const encryptedValue: EncryptedPayload = encryptBuffer(Buffer.from(plaintext, 'utf8'), dek);
  const wrappedDek: EncryptedPayload = encryptBuffer(dek, masterKey);

  return {
    encryptionKeyId: buildVariablesEncryptionKeyId(masterKey),
    valueCiphertext: JSON.stringify({
      algorithm: 'aes-256-gcm',
      ciphertext: encryptedValue.ciphertext.toString('base64'),
      dekWrapIv: wrappedDek.iv.toString('base64'),
      dekWrapTag: wrappedDek.tag.toString('base64'),
      valueIv: encryptedValue.iv.toString('base64'),
      valueTag: encryptedValue.tag.toString('base64'),
      version: 1,
      wrappedDek: wrappedDek.ciphertext.toString('base64'),
    }),
    valueFingerprint: createVariableValueFingerprint(plaintext, masterKey),
  };
}

export function decryptVariableValueFromStorage(
  valueCiphertext: string,
  encryptionKeyId: string,
  masterKey: Buffer,
): string {
  assertSupportedEncryptionKeyId(encryptionKeyId, masterKey);
  const envelope: VariableCiphertextEnvelopeV1 = parseVariableCiphertextEnvelope(valueCiphertext);
  const dek: Buffer = unwrapDataEncryptionKey(envelope, masterKey);
  return decryptEnvelopeValue(envelope, dek);
}

function parseVariableCiphertextEnvelope(valueCiphertext: string): VariableCiphertextEnvelopeV1 {
  let parsed: ParsedVariableCiphertextEnvelope;

  try {
    parsed = JSON.parse(valueCiphertext) as ParsedVariableCiphertextEnvelope;
  } catch {
    throw new Error('Encrypted variable value is not valid JSON.');
  }

  if (!isVariableCiphertextEnvelopeV1(parsed)) {
    throw new Error('Encrypted variable value has an unsupported envelope format.');
  }

  return parsed;
}

function isVariableCiphertextEnvelopeV1(
  parsed: ParsedVariableCiphertextEnvelope | null,
): parsed is VariableCiphertextEnvelopeV1 {
  return (
    parsed !== null &&
    parsed.version === 1 &&
    parsed.algorithm === 'aes-256-gcm' &&
    typeof parsed.ciphertext === 'string' &&
    hasText(parsed.dekWrapIv) &&
    hasText(parsed.dekWrapTag) &&
    hasText(parsed.valueIv) &&
    hasText(parsed.valueTag) &&
    hasText(parsed.wrappedDek)
  );
}

function assertSupportedEncryptionKeyId(encryptionKeyId: string, masterKey: Buffer): void {
  const currentKeyId: string = buildVariablesEncryptionKeyId(masterKey);
  if (encryptionKeyId !== currentKeyId) {
    throw new Error(
      `Encrypted variable value uses unsupported key id "${encryptionKeyId}" (current "${currentKeyId}").`,
    );
  }
}

function buildVariablesEncryptionKeyId(masterKey: Buffer): string {
  return `${encryptionKeyIdPrefix}${createHash('sha256').update(masterKey).digest('hex').slice(0, 16)}`;
}

function unwrapDataEncryptionKey(envelope: VariableCiphertextEnvelopeV1, masterKey: Buffer): Buffer {
  return decryptBuffer(
    Buffer.from(envelope.wrappedDek, 'base64'),
    masterKey,
    Buffer.from(envelope.dekWrapIv, 'base64'),
    Buffer.from(envelope.dekWrapTag, 'base64'),
  );
}

function decryptEnvelopeValue(envelope: VariableCiphertextEnvelopeV1, dek: Buffer): string {
  return decryptBuffer(
    Buffer.from(envelope.ciphertext, 'base64'),
    dek,
    Buffer.from(envelope.valueIv, 'base64'),
    Buffer.from(envelope.valueTag, 'base64'),
  ).toString('utf8');
}

function encryptBuffer(plaintext: Buffer, key: Buffer): EncryptedPayload {
  const iv: Buffer = randomBytes(aes256GcmIvBytes);
  const cipher: CipherGCM = createCipheriv(aes256GcmAlgorithm, key, iv, aes256GcmOptions);
  const ciphertext: Buffer = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    ciphertext,
    iv,
    tag: cipher.getAuthTag(),
  };
}

function decryptBuffer(ciphertext: Buffer, key: Buffer, iv: Buffer, tag: Buffer): Buffer {
  const decipher: DecipherGCM = createDecipheriv(aes256GcmAlgorithm, key, iv, aes256GcmOptions);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function createVariableValueFingerprint(plaintext: string, masterKey: Buffer): string {
  const fingerprintKey: Buffer = Buffer.from(
    hkdfSync('sha256', masterKey, Buffer.alloc(0), Buffer.from(fingerprintContext, 'utf8'), aes256KeyBytes),
  );

  return createHmac('sha256', fingerprintKey).update(plaintext, 'utf8').digest('hex');
}
