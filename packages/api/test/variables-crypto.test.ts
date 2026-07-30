import { describe, expect, it } from 'vitest';
import {
  decryptTenantVariableValueFromStorage,
  encryptTenantVariableValueForStorage,
  parseTenantSecretsKek,
  parseVariablesMasterKey,
  rewrapVariableValueForStorage,
  type EncryptedVariableValue,
} from '../src/lib/variables-crypto';

type TestVariableCiphertextEnvelopeTamperField = 'ciphertext' | 'wrappedDek';

interface TestVariableCiphertextEnvelope {
  algorithm: string;
  ciphertext: string;
  dekWrapIv: string;
  dekWrapTag: string;
  valueIv: string;
  valueTag: string;
  version: number;
  wrappedDek: string;
}

describe('variables crypto helpers', (): void => {
  it('rejects malformed master keys', (): void => {
    expect((): Buffer => parseVariablesMasterKey('xyz')).toThrow(
      'COMPARTMENT_VARIABLES_MASTER_KEY must be exactly 64 hex characters.',
    );
    expect((): Buffer => parseVariablesMasterKey('11'.repeat(16))).toThrow(
      'COMPARTMENT_VARIABLES_MASTER_KEY must be exactly 64 hex characters.',
    );
    expect((): Buffer => parseVariablesMasterKey(`${'11'.repeat(32)}a`)).toThrow(
      'COMPARTMENT_VARIABLES_MASTER_KEY must be exactly 64 hex characters.',
    );
  });

  it('parses a valid 32-byte hex master key', (): void => {
    expect(parseVariablesMasterKey('11'.repeat(32))).toEqual(Buffer.from('11'.repeat(32), 'hex'));
  });

  it('decrypts a stored variable envelope', (): void => {
    const masterKey: Buffer = parseTenantSecretsKek('11'.repeat(32));
    const encryptedValue: EncryptedVariableValue = encryptTenantVariableValueForStorage(
      'postgres://secret',
      masterKey,
      masterKey,
    );

    expect(
      decryptTenantVariableValueFromStorage(encryptedValue.valueCiphertext, encryptedValue.encryptionKeyId, masterKey),
    ).toBe('postgres://secret');
  });

  it('rejects ciphertext encrypted under a different master key', (): void => {
    const encryptingMasterKey: Buffer = parseVariablesMasterKey('11'.repeat(32));
    const readingMasterKey: Buffer = parseVariablesMasterKey('22'.repeat(32));
    const encryptedValue: EncryptedVariableValue = encryptTenantVariableValueForStorage(
      'postgres://secret',
      encryptingMasterKey,
      encryptingMasterKey,
    );

    expect((): string =>
      decryptTenantVariableValueFromStorage(
        encryptedValue.valueCiphertext,
        encryptedValue.encryptionKeyId,
        readingMasterKey,
      ),
    ).toThrow(/unsupported key id/);
  });

  it('rejects malformed ciphertext envelopes', (): void => {
    const masterKey: Buffer = parseVariablesMasterKey('11'.repeat(32));
    const encryptedValue: EncryptedVariableValue = encryptTenantVariableValueForStorage(
      'postgres://secret',
      masterKey,
      masterKey,
    );

    expect((): string =>
      decryptTenantVariableValueFromStorage('not-json', encryptedValue.encryptionKeyId, masterKey),
    ).toThrow('Encrypted value is not valid JSON.');
  });

  it.each(['ciphertext', 'wrappedDek'] as const)(
    'rejects authenticated envelopes after %s tampering',
    (field: TestVariableCiphertextEnvelopeTamperField): void => {
      const masterKey: Buffer = parseVariablesMasterKey('11'.repeat(32));
      const encryptedValue: EncryptedVariableValue = encryptTenantVariableValueForStorage(
        'postgres://secret',
        masterKey,
        masterKey,
      );
      const tamperedValueCiphertext: string = tamperEnvelopeField(encryptedValue.valueCiphertext, field);

      expect((): string =>
        decryptTenantVariableValueFromStorage(tamperedValueCiphertext, encryptedValue.encryptionKeyId, masterKey),
      ).toThrow(/authenticate/i);
    },
  );

  it('re-wraps only the DEK and preserves the stable envelope format', (): void => {
    const oldKek: Buffer = parseTenantSecretsKek('11'.repeat(32));
    const newKek: Buffer = parseTenantSecretsKek('22'.repeat(32));
    const encrypted: EncryptedVariableValue = encryptTenantVariableValueForStorage('postgres://secret', oldKek, oldKek);
    const before: TestVariableCiphertextEnvelope = JSON.parse(
      encrypted.valueCiphertext,
    ) as TestVariableCiphertextEnvelope;
    const rewrapped: Pick<EncryptedVariableValue, 'encryptionKeyId' | 'valueCiphertext'> =
      rewrapVariableValueForStorage(encrypted.valueCiphertext, encrypted.encryptionKeyId, oldKek, newKek);
    const after: TestVariableCiphertextEnvelope = JSON.parse(
      rewrapped.valueCiphertext,
    ) as TestVariableCiphertextEnvelope;

    expect(Object.keys(after)).toEqual([
      'algorithm',
      'ciphertext',
      'dekWrapIv',
      'dekWrapTag',
      'valueIv',
      'valueTag',
      'version',
      'wrappedDek',
    ]);
    expect(after).toMatchObject({
      algorithm: 'aes-256-gcm',
      ciphertext: before.ciphertext,
      valueIv: before.valueIv,
      valueTag: before.valueTag,
      version: 1,
    });
    expect((): string =>
      decryptTenantVariableValueFromStorage(rewrapped.valueCiphertext, rewrapped.encryptionKeyId, oldKek),
    ).toThrow();
    expect(decryptTenantVariableValueFromStorage(rewrapped.valueCiphertext, rewrapped.encryptionKeyId, newKek)).toBe(
      'postgres://secret',
    );
  });
});

function tamperEnvelopeField(valueCiphertext: string, field: TestVariableCiphertextEnvelopeTamperField): string {
  const envelope: TestVariableCiphertextEnvelope = JSON.parse(valueCiphertext) as TestVariableCiphertextEnvelope;
  const bytes: Buffer = Buffer.from(envelope[field], 'base64');
  bytes[0] = (bytes[0] ?? 0) ^ 1;
  envelope[field] = bytes.toString('base64');

  return JSON.stringify(envelope);
}
