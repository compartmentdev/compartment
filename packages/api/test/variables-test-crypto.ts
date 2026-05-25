import {
  createCipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  type CipherGCM,
  type CipherGCMTypes,
} from 'node:crypto';

const aes256KeyBytes: number = 32;
const aes256GcmAlgorithm: CipherGCMTypes = 'aes-256-gcm';
const aes256GcmIvBytes: number = 12;
const encryptionKeyIdPrefix: string = 'install-kek-sha256:';
const fingerprintContext: string = 'compartment:variables:fingerprint:v1';

export interface TestEncryptedVariableValue {
  encryptionKeyId: string;
  valueCiphertext: string;
  valueFingerprint: string;
}

interface EncryptedPayload {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
}

export function encryptVariableValueForStorageForTests(
  plaintext: string,
  masterKey: Buffer,
): TestEncryptedVariableValue {
  const dek: Buffer = randomBytes(aes256KeyBytes);
  const encryptedValue: EncryptedPayload = encryptBuffer(Buffer.from(plaintext, 'utf8'), dek);
  const wrappedDek: EncryptedPayload = encryptBuffer(dek, masterKey);

  return {
    encryptionKeyId: `${encryptionKeyIdPrefix}${createHash('sha256').update(masterKey).digest('hex').slice(0, 16)}`,
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
    valueFingerprint: createValueFingerprint(plaintext, masterKey),
  };
}

function encryptBuffer(plaintext: Buffer, key: Buffer): EncryptedPayload {
  const iv: Buffer = randomBytes(aes256GcmIvBytes);
  const cipher: CipherGCM = createCipheriv(aes256GcmAlgorithm, key, iv);
  const ciphertext: Buffer = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    ciphertext,
    iv,
    tag: cipher.getAuthTag(),
  };
}

function createValueFingerprint(plaintext: string, masterKey: Buffer): string {
  const fingerprintKey: Buffer = Buffer.from(
    hkdfSync('sha256', masterKey, Buffer.alloc(0), Buffer.from(fingerprintContext, 'utf8'), aes256KeyBytes),
  );

  return createHmac('sha256', fingerprintKey).update(plaintext, 'utf8').digest('hex');
}
