import type { VariableSensitivity } from '@compartment/contracts';
import { createVariableCollisionError } from '../errors/api-business-error';
import {
  createVariableGroup,
  importVariableGroupEntriesWithAudit,
  upsertVariableGroupEntryWithAudit,
} from '../queries/variable-groups.query';
import type { EncryptedVariableValue } from '../lib/variables-crypto';
import { assertVariableGroupMutationConflictsAbsent } from './variable-groups.collision.service';
import {
  handleDuplicateVariableGroupName,
  loadVariableGroup,
  readVariableGroupImportConflicts,
} from './variable-groups.service.helpers';
import type {
  CreateVariableGroupInput,
  ImportVariableGroupInput,
  ImportVariableGroupResult,
  LoadedVariableGroup,
  PutVariableGroupVariableInput,
  VariableGroupResponseResult,
} from './variable-groups.service.types';
import {
  buildCreateVariableGroupInput,
  buildVariableGroupEntryInput,
  buildVariableGroupImportInput,
  buildVariableGroupSetChangeEventInput,
  encryptVariableGroupEntries,
  encryptVariableGroupValue,
} from './variable-groups.write.helpers';
import { readVariableGroupKeyNames } from './variable-groups.key-names.helpers';
import { showVariableGroupForPrincipal } from './variable-groups.read.service';
import { readVariableSensitivity } from './variables.service.helpers';

export async function createVariableGroupForPrincipal(
  input: CreateVariableGroupInput,
): Promise<VariableGroupResponseResult> {
  try {
    await createVariableGroup(buildCreateVariableGroupInput(input, new Date()));
  } catch (error) {
    if (error instanceof Error) {
      handleDuplicateVariableGroupName(error, input.variableGroupName);
    }
    throw error;
  }

  return await showVariableGroupForPrincipal(input);
}

export async function putVariableGroupVariableForPrincipal(
  input: PutVariableGroupVariableInput,
): Promise<VariableGroupResponseResult> {
  const now: Date = new Date();
  const variableGroup: LoadedVariableGroup = await loadVariableGroup(input.organizationId, input.variableGroupName);
  const sensitivity: VariableSensitivity = readVariableSensitivity(input);
  const encryptedValue: EncryptedVariableValue = encryptVariableGroupValue(input.value);

  await assertVariableGroupMutationConflictsAbsent(variableGroup, [input.keyName], input.organizationId);
  await upsertVariableGroupEntryWithAudit(
    buildVariableGroupEntryInput(input.principalId, variableGroup.id, input.keyName, sensitivity, encryptedValue, now),
    buildVariableGroupSetChangeEventInput(
      input.principalId,
      input.organizationId,
      variableGroup.id,
      input.keyName,
      sensitivity,
      encryptedValue,
    ),
  );

  return await showVariableGroupForPrincipal(input);
}

export async function importVariableGroupForPrincipal(
  input: ImportVariableGroupInput,
): Promise<ImportVariableGroupResult> {
  const now: Date = new Date();
  const variableGroup: LoadedVariableGroup = await loadVariableGroup(input.organizationId, input.variableGroupName);
  const sensitivity: VariableSensitivity = readVariableSensitivity(input);
  const importedKeyNames: string[] = readVariableGroupKeyNames(input.entries);

  assertVariableGroupImportConflictsAbsent(input, variableGroup);
  await assertVariableGroupMutationConflictsAbsent(variableGroup, importedKeyNames, input.organizationId);
  await writeImportedVariableGroupEntries(input, variableGroup.id, sensitivity, now);

  return await buildImportedVariableGroupResult(input, importedKeyNames);
}

function assertVariableGroupImportConflictsAbsent(
  input: ImportVariableGroupInput,
  variableGroup: LoadedVariableGroup,
): void {
  const conflictingKeyNames: string[] =
    input.replace === true ? [] : readVariableGroupImportConflicts(input.entries, variableGroup);

  if (conflictingKeyNames.length > 0) {
    throw createVariableCollisionError(
      `Variable group import would overwrite existing keys: ${conflictingKeyNames.join(', ')}. Retry with --replace.`,
    );
  }
}

async function writeImportedVariableGroupEntries(
  input: ImportVariableGroupInput,
  variableGroupId: string,
  sensitivity: VariableSensitivity,
  now: Date,
): Promise<void> {
  await importVariableGroupEntriesWithAudit(
    buildVariableGroupImportInput(input, variableGroupId, sensitivity, encryptVariableGroupEntries(input.entries), now),
  );
}

async function buildImportedVariableGroupResult(
  input: ImportVariableGroupInput,
  importedKeyNames: string[],
): Promise<ImportVariableGroupResult> {
  return {
    importedKeyNames,
    variableGroup: (await showVariableGroupForPrincipal(input)).variableGroup,
  };
}
