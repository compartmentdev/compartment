import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  type CipherGCM,
  type CipherGCMOptions,
  type CipherGCMTypes,
  type DecipherGCM,
} from 'node:crypto';
import { hasText } from './text';
import type {
  Aes256GcmEnvelopeCiphertext,
  Aes256GcmEnvelopeV1,
  ParsedAes256GcmEnvelope,
} from './aes-gcm-envelope.types';

const aes256KeyBytes: number = 32;
const aes256GcmAlgorithm: CipherGCMTypes = 'aes-256-gcm';
const aes256GcmAuthTagBytes: number = 16;
const aes256GcmIvBytes: number = 12;
const aes256GcmOptions: CipherGCMOptions = { authTagLength: aes256GcmAuthTagBytes };

interface EncryptedPayload {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
}

export function parseAes256GcmKey(value: string, variableName: string): Buffer {
  if (!hasText(value) || !/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${variableName} must be exactly 64 hex characters.`);
  }
  return Buffer.from(value, 'hex');
}

export function encryptAes256GcmEnvelope(
  plaintext: string,
  key: Buffer,
  keyIdNamespace: string,
): Aes256GcmEnvelopeCiphertext {
  assertAes256Key(key);
  const dek: Buffer = randomBytes(aes256KeyBytes);
  const encryptedValue: EncryptedPayload = encryptBuffer(Buffer.from(plaintext, 'utf8'), dek);
  const wrappedDek: EncryptedPayload = encryptBuffer(dek, key);

  return {
    ciphertext: serializeEnvelope({
      algorithm: 'aes-256-gcm',
      ciphertext: encryptedValue.ciphertext.toString('base64'),
      dekWrapIv: wrappedDek.iv.toString('base64'),
      dekWrapTag: wrappedDek.tag.toString('base64'),
      valueIv: encryptedValue.iv.toString('base64'),
      valueTag: encryptedValue.tag.toString('base64'),
      version: 1,
      wrappedDek: wrappedDek.ciphertext.toString('base64'),
    }),
    keyId: createAes256GcmKeyId(key, keyIdNamespace),
  };
}

export function createAes256GcmKeyId(key: Buffer, namespace: string): string {
  assertAes256Key(key);
  return `${namespace}-sha256:${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
}

export function decryptAes256GcmEnvelope(ciphertext: string, key: Buffer): string {
  assertAes256Key(key);
  const envelope: Aes256GcmEnvelopeV1 = parseAes256GcmEnvelope(ciphertext);
  const dek: Buffer = unwrapDataEncryptionKey(envelope, key);
  return decryptBuffer(
    Buffer.from(envelope.ciphertext, 'base64'),
    dek,
    Buffer.from(envelope.valueIv, 'base64'),
    Buffer.from(envelope.valueTag, 'base64'),
  ).toString('utf8');
}

export function rewrapAes256GcmEnvelope(ciphertext: string, oldKey: Buffer, newKey: Buffer): string {
  assertAes256Key(newKey);
  const envelope: Aes256GcmEnvelopeV1 = parseAes256GcmEnvelope(ciphertext);
  const dek: Buffer = unwrapDataEncryptionKey(envelope, oldKey);
  const wrappedDek: EncryptedPayload = encryptBuffer(dek, newKey);

  return serializeEnvelope({
    ...envelope,
    dekWrapIv: wrappedDek.iv.toString('base64'),
    dekWrapTag: wrappedDek.tag.toString('base64'),
    wrappedDek: wrappedDek.ciphertext.toString('base64'),
  });
}

function parseAes256GcmEnvelope(ciphertext: string): Aes256GcmEnvelopeV1 {
  let parsed: ParsedAes256GcmEnvelope;
  try {
    parsed = JSON.parse(ciphertext) as ParsedAes256GcmEnvelope;
  } catch {
    throw new Error('Encrypted value is not valid JSON.');
  }
  if (!isAes256GcmEnvelopeV1(parsed)) {
    throw new Error('Encrypted value has an unsupported envelope format.');
  }
  return parsed;
}

function isAes256GcmEnvelopeV1(parsed: ParsedAes256GcmEnvelope | null): parsed is Aes256GcmEnvelopeV1 {
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

function serializeEnvelope(envelope: Aes256GcmEnvelopeV1): string {
  return JSON.stringify(envelope);
}

function unwrapDataEncryptionKey(envelope: Aes256GcmEnvelopeV1, key: Buffer): Buffer {
  assertAes256Key(key);
  return decryptBuffer(
    Buffer.from(envelope.wrappedDek, 'base64'),
    key,
    Buffer.from(envelope.dekWrapIv, 'base64'),
    Buffer.from(envelope.dekWrapTag, 'base64'),
  );
}

function encryptBuffer(plaintext: Buffer, key: Buffer): EncryptedPayload {
  const iv: Buffer = randomBytes(aes256GcmIvBytes);
  const cipher: CipherGCM = createCipheriv(aes256GcmAlgorithm, key, iv, aes256GcmOptions);
  const ciphertext: Buffer = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

function decryptBuffer(ciphertext: Buffer, key: Buffer, iv: Buffer, tag: Buffer): Buffer {
  const decipher: DecipherGCM = createDecipheriv(aes256GcmAlgorithm, key, iv, aes256GcmOptions);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function assertAes256Key(key: Buffer): void {
  if (key.length !== aes256KeyBytes) {
    throw new Error('AES-256-GCM keys must be exactly 32 bytes.');
  }
}
