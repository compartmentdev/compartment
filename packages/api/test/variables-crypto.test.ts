import { describe, expect, it } from 'vitest';
import { decryptVariableValueFromStorage, parseVariablesMasterKey } from '../src/lib/variables-crypto';
import { encryptVariableValueForStorageForTests, type TestEncryptedVariableValue } from './variables-test-crypto';

type TestVariableCiphertextEnvelopeTagField = 'dekWrapTag' | 'valueTag';

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
    const masterKey: Buffer = parseVariablesMasterKey('11'.repeat(32));
    const encryptedValue: TestEncryptedVariableValue = encryptVariableValueForStorageForTests(
      'postgres://secret',
      masterKey,
    );

    expect(
      decryptVariableValueFromStorage(encryptedValue.valueCiphertext, encryptedValue.encryptionKeyId, masterKey),
    ).toBe('postgres://secret');
  });

  it('rejects ciphertext encrypted under a different master key', (): void => {
    const encryptingMasterKey: Buffer = parseVariablesMasterKey('11'.repeat(32));
    const readingMasterKey: Buffer = parseVariablesMasterKey('22'.repeat(32));
    const encryptedValue: TestEncryptedVariableValue = encryptVariableValueForStorageForTests(
      'postgres://secret',
      encryptingMasterKey,
    );

    expect((): string =>
      decryptVariableValueFromStorage(encryptedValue.valueCiphertext, encryptedValue.encryptionKeyId, readingMasterKey),
    ).toThrow(/unsupported key id/);
  });

  it('rejects malformed ciphertext envelopes', (): void => {
    const masterKey: Buffer = parseVariablesMasterKey('11'.repeat(32));
    const encryptedValue: TestEncryptedVariableValue = encryptVariableValueForStorageForTests(
      'postgres://secret',
      masterKey,
    );

    expect((): string =>
      decryptVariableValueFromStorage('not-json', encryptedValue.encryptionKeyId, masterKey),
    ).toThrow('Encrypted variable value is not valid JSON.');
  });

  it.each(['dekWrapTag', 'valueTag'] as const)(
    'rejects envelopes with a truncated %s',
    (tagField: TestVariableCiphertextEnvelopeTagField): void => {
      const masterKey: Buffer = parseVariablesMasterKey('11'.repeat(32));
      const encryptedValue: TestEncryptedVariableValue = encryptVariableValueForStorageForTests(
        'postgres://secret',
        masterKey,
      );
      const truncatedValueCiphertext: string = truncateEnvelopeTag(encryptedValue.valueCiphertext, tagField);

      expect((): string =>
        decryptVariableValueFromStorage(truncatedValueCiphertext, encryptedValue.encryptionKeyId, masterKey),
      ).toThrow();
    },
  );
});

function truncateEnvelopeTag(valueCiphertext: string, tagField: TestVariableCiphertextEnvelopeTagField): string {
  const envelope: TestVariableCiphertextEnvelope = JSON.parse(valueCiphertext) as TestVariableCiphertextEnvelope;
  envelope[tagField] = Buffer.from(envelope[tagField], 'base64').subarray(0, -1).toString('base64');

  return JSON.stringify(envelope);
}
