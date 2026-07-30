import type { VariableImportEntry } from '@compartment/contracts';
import { createVariableCollisionError } from '../errors/api-business-error';
import { encryptTenantVariableValueForStorage, type EncryptedVariableValue } from '../lib/variables-crypto';
import { getApiConfig } from '../runtime/runtime-access';
import { loadEffectiveVariables } from './effective-variables.service';
import type { EffectiveVariable } from './effective-variables.service.types';
import { buildLoadEffectiveVariablesInput } from './variables.service.helpers';
import type { ImportVariablesInput, VariableTargetContext } from './variables.service.types';
import { assertNoResourceOutputImportConflicts } from './variables.resource-output-conflicts.service';
import { findDuplicateImportedKeyNames } from './variables.service.write.helpers';

export interface ImportedEncryptedEntry {
  encryptedValue: EncryptedVariableValue;
  entry: VariableImportEntry;
}

export async function prepareImportedEncryptedEntries(
  input: ImportVariablesInput,
  target: VariableTargetContext,
): Promise<ImportedEncryptedEntry[]> {
  const duplicateKeyNames: string[] = findDuplicateImportedKeyNames(input);
  if (duplicateKeyNames.length > 0) {
    throw createVariableCollisionError(buildDuplicateImportMessage(duplicateKeyNames));
  }
  await assertNoResourceOutputImportConflicts(input, target);
  if (input.replace !== true) {
    await assertImportConflictsAbsent(input, target);
  }

  return input.entries.map(
    (entry: VariableImportEntry): ImportedEncryptedEntry =>
      buildImportedEncryptedEntry(entry, getApiConfig().tenantSecretsKek, getApiConfig().variablesMasterKey),
  );
}

async function assertImportConflictsAbsent(input: ImportVariablesInput, target: VariableTargetContext): Promise<void> {
  const existingVariables: EffectiveVariable[] = await loadEffectiveVariables(buildLoadEffectiveVariablesInput(target));
  const existingKeyNames: Set<string> = new Set<string>(
    existingVariables.map((variable: EffectiveVariable): string => variable.keyName),
  );
  const conflictingKeyNames: string[] = input.entries
    .map((entry: VariableImportEntry): string => entry.keyName)
    .filter((keyName: string): boolean => existingKeyNames.has(keyName));

  if (conflictingKeyNames.length > 0) {
    throw createVariableCollisionError(buildImportConflictMessage(conflictingKeyNames));
  }
}

function buildDuplicateImportMessage(duplicateKeyNames: readonly string[]): string {
  return `Duplicate imported variable keys: ${duplicateKeyNames.join(', ')}.`;
}

function buildImportConflictMessage(conflictingKeyNames: readonly string[]): string {
  return `Variable import would overwrite existing winners for: ${conflictingKeyNames.join(', ')}. Retry with --replace.`;
}

function buildImportedEncryptedEntry(
  entry: VariableImportEntry,
  tenantSecretsKek: Buffer,
  fingerprintKey: Buffer,
): ImportedEncryptedEntry {
  return {
    encryptedValue: encryptTenantVariableValueForStorage(entry.value, tenantSecretsKek, fingerprintKey),
    entry,
  };
}
