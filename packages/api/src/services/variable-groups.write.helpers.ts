import type { VariableImportEntry, VariableSensitivity } from '@compartment/contracts';
import { createId } from '../lib/tokens';
import { encryptTenantVariableValueForStorage, type EncryptedVariableValue } from '../lib/variables-crypto';
import type {
  CreateVariableGroupInput as CreateVariableGroupQueryInput,
  ImportVariableGroupEntriesInput,
  UpsertVariableGroupEntryInput,
} from '../queries/variable-groups.query.types';
import type { InsertVariableChangeEventInput } from '../queries/variables.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import { buildVariableGroupFingerprintsJson } from './variable-groups.service.helpers';
import { readVariableGroupKeyNames } from './variable-groups.key-names.helpers';
import type { CreateVariableGroupInput, ImportVariableGroupInput } from './variable-groups.service.types';

export function buildCreateVariableGroupInput(
  input: CreateVariableGroupInput,
  now: Date,
): CreateVariableGroupQueryInput {
  return {
    createdByPrincipalId: input.principalId,
    description: input.description,
    id: createId('vset'),
    name: input.variableGroupName,
    organizationId: input.organizationId,
    updatedAt: now,
  };
}

export function encryptVariableGroupValue(value: string): EncryptedVariableValue {
  return encryptTenantVariableValueForStorage(
    value,
    getApiConfig().tenantSecretsKek,
    getApiConfig().variablesMasterKey,
  );
}

export function buildVariableGroupSetChangeEventInput(
  principalId: string,
  organizationId: string,
  variableGroupId: string,
  keyName: string,
  sensitivity: VariableSensitivity,
  encryptedValue: EncryptedVariableValue,
): InsertVariableChangeEventInput {
  return {
    actorPrincipalId: principalId,
    fingerprintsJson: JSON.stringify([encryptedValue.valueFingerprint]),
    keyNamesJson: JSON.stringify([keyName]),
    operation: 'set',
    organizationId,
    sensitivityJson: JSON.stringify([sensitivity]),
    targetId: variableGroupId,
    targetType: 'variable_set',
  };
}

export function buildVariableGroupImportInput(
  input: ImportVariableGroupInput,
  variableGroupId: string,
  sensitivity: VariableSensitivity,
  encryptedValues: readonly EncryptedVariableValue[],
  now: Date,
): ImportVariableGroupEntriesInput {
  return {
    changeEvent: buildVariableGroupImportChangeEventInput(input, variableGroupId, sensitivity, encryptedValues),
    updatedAt: now,
    values: input.entries.map(
      (entry: VariableImportEntry, index: number): UpsertVariableGroupEntryInput =>
        buildVariableGroupEntryInput(
          input.principalId,
          variableGroupId,
          entry.keyName,
          sensitivity,
          encryptedValues[index]!,
          now,
        ),
    ),
    variableGroupId,
  };
}

export function encryptVariableGroupEntries(entries: readonly VariableImportEntry[]): EncryptedVariableValue[] {
  return entries.map(
    (entry: VariableImportEntry): EncryptedVariableValue =>
      encryptTenantVariableValueForStorage(
        entry.value,
        getApiConfig().tenantSecretsKek,
        getApiConfig().variablesMasterKey,
      ),
  );
}

function buildVariableGroupImportChangeEventInput(
  input: ImportVariableGroupInput,
  variableGroupId: string,
  sensitivity: VariableSensitivity,
  encryptedValues: readonly EncryptedVariableValue[],
): InsertVariableChangeEventInput {
  return {
    actorPrincipalId: input.principalId,
    fingerprintsJson: buildVariableGroupFingerprintsJson(encryptedValues),
    keyNamesJson: JSON.stringify(readVariableGroupKeyNames(input.entries)),
    operation: input.replace === true ? 'replace' : 'import',
    organizationId: input.organizationId,
    sensitivityJson: JSON.stringify(input.entries.map((): VariableSensitivity => sensitivity)),
    targetId: variableGroupId,
    targetType: 'variable_set',
  };
}

export function buildVariableGroupEntryInput(
  principalId: string,
  variableGroupId: string,
  keyName: string,
  sensitivity: VariableSensitivity,
  encryptedValue: EncryptedVariableValue,
  now: Date,
): UpsertVariableGroupEntryInput {
  return {
    createdByPrincipalId: principalId,
    encryptionKeyId: encryptedValue.encryptionKeyId,
    id: createId('vse'),
    keyName,
    sensitivity,
    updatedAt: now,
    updatedByPrincipalId: principalId,
    valueCiphertext: encryptedValue.valueCiphertext,
    valueFingerprint: encryptedValue.valueFingerprint,
    variableGroupId,
  };
}
