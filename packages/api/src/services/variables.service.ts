import type { VariableImportEntry, VariableSensitivity } from '@compartment/contracts';
import { createVariableNotFoundError } from '../errors/api-business-error';
import { createId } from '../lib/tokens';
import { encryptVariableValueForStorage, type EncryptedVariableValue } from '../lib/variables-crypto';
import {
  deleteEnvironmentVariableValueWithAudit,
  importEnvironmentVariableValues,
  upsertEnvironmentVariableValueWithAudit,
} from '../queries/variables.query';
import type { UpsertEnvironmentVariableValueInput } from '../queries/variables.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import { loadEffectiveVariables } from './effective-variables.service';
import type { EffectiveVariable, ListedVariable } from './effective-variables.service.types';
import { loadEnvironmentVariableInventory } from './variables.inventory.service';
import {
  resolveReadVariableTarget,
  resolveRemoveVariableTarget,
  resolveWriteVariableTarget,
} from './variables.target.service';
import { prepareImportedEncryptedEntries, type ImportedEncryptedEntry } from './variables.service.import.helpers';
import { buildLoadEffectiveVariablesInput, readVariableSensitivity } from './variables.service.helpers';
import {
  removeResourceOutputVariableBinding,
  setResourceOutputVariableForPrincipal,
} from './variables.resource-output.service';
import { assertNoResourceOutputBindingConflict } from './variables.resource-output-conflicts.service';
import {
  buildImportVariableChangeEventInput,
  buildRemoveVariableChangeEventInput,
  buildSetVariableChangeEventInput,
  buildShowVariableAfterWriteInput,
  buildUpsertVariableInput,
} from './variables.service.write.helpers';
import type {
  ImportVariablesInput,
  ImportVariablesResult,
  RemoveVariableInput,
  SetVariableInput,
  ShowVariableInput,
  VariableDetailResult,
  VariableListResult,
  VariableResult,
  VariableTargetContext,
  VariableTargetInput,
} from './variables.service.types';

export async function setVariableForPrincipal(input: SetVariableInput): Promise<VariableResult> {
  const now: Date = new Date();
  const target: VariableTargetContext = await resolveWriteVariableTarget(input, now, 'variable.write');
  if (input.fromResource !== undefined) {
    return await setResourceOutputVariableForPrincipal(input, target, now);
  }
  if (input.value === undefined) {
    throw new Error('Expected variable value.');
  }
  await assertNoResourceOutputBindingConflict(input, target);
  const sensitivity: VariableSensitivity = readVariableSensitivity(input);
  const encryptedValue: EncryptedVariableValue = encryptVariableValueForStorage(
    input.value,
    getApiConfig().variablesMasterKey,
  );

  await upsertEnvironmentVariableValueWithAudit(
    buildUpsertVariableInput(input, target, createId('var'), now, sensitivity, encryptedValue),
    buildSetVariableChangeEventInput(input, target, sensitivity, encryptedValue),
  );

  return await showVariableForPrincipal(buildShowVariableAfterWriteInput(input, target));
}

export async function importVariablesForPrincipal(input: ImportVariablesInput): Promise<ImportVariablesResult> {
  const now: Date = new Date();
  const target: VariableTargetContext = await resolveWriteVariableTarget(input, now, 'variable.write');
  const sensitivity: VariableSensitivity = readVariableSensitivity(input);
  const encryptedEntries: ImportedEncryptedEntry[] = await prepareImportedEncryptedEntries(input, target);

  await persistImportedVariables(input, target, sensitivity, encryptedEntries, now);
  return buildImportVariablesResult(input, target);
}

export async function showVariableForPrincipal(input: ShowVariableInput): Promise<VariableResult> {
  const target: VariableTargetContext = await resolveReadVariableTarget(input, 'variable.value.read');
  const variables: EffectiveVariable[] = await loadEffectiveVariables(buildLoadEffectiveVariablesInput(target));
  const variable: EffectiveVariable | undefined = variables.find(
    (candidate: EffectiveVariable): boolean => candidate.keyName === input.keyName,
  );
  if (variable === undefined) {
    throw createVariableNotFoundError();
  }

  return {
    environment: target.environment,
    project: target.project,
    resourceName: target.resourceName,
    serviceName: target.serviceName,
    variable: buildVariableDetailResult(variable),
  };
}

export async function listVariablesForPrincipal(input: VariableTargetInput): Promise<VariableListResult> {
  const target: VariableTargetContext = await resolveReadVariableTarget(input, 'variable.metadata.read');
  const variables: ListedVariable[] =
    target.serviceName === null && target.resourceName === null
      ? await loadEnvironmentVariableInventory(target)
      : await loadEffectiveVariables(buildLoadEffectiveVariablesInput(target));

  return {
    environment: target.environment,
    project: target.project,
    resourceName: target.resourceName,
    serviceName: target.serviceName,
    variables,
  };
}

export async function removeVariableForPrincipal(input: RemoveVariableInput): Promise<void> {
  const target: VariableTargetContext = await resolveRemoveVariableTarget(input, 'variable.write');
  if (await removeDirectVariable(input, target)) {
    return;
  }
  if (await removeResourceOutputVariableBinding(input, target)) {
    return;
  }

  throw createVariableNotFoundError();
}

async function removeDirectVariable(input: RemoveVariableInput, target: VariableTargetContext): Promise<boolean> {
  if (target.serviceName !== null && target.service === null) {
    return false;
  }

  return await deleteEnvironmentVariableValueWithAudit(
    {
      environmentId: target.environment.id,
      keyName: input.keyName,
      projectServiceId: target.service?.id ?? null,
      targetResourceName: target.resourceName,
    },
    buildRemoveVariableChangeEventInput(input, target),
  );
}

function buildVariableDetailResult(variable: EffectiveVariable): VariableDetailResult {
  return {
    keyName: variable.keyName,
    scopeResourceName: variable.scopeResourceName,
    scopeServiceName: variable.scopeServiceName,
    scopeType: variable.scopeType,
    sensitivity: variable.sensitivity,
    sourceResourceOutput: variable.sourceResourceOutput,
    sourceType: variable.sourceType,
    sourceVariableSetName: variable.sourceVariableSetName,
    value: variable.sensitivity === 'sensitive' ? null : variable.value,
    valueHidden: variable.sensitivity === 'sensitive',
  };
}

async function persistImportedVariables(
  input: ImportVariablesInput,
  target: VariableTargetContext,
  sensitivity: VariableSensitivity,
  encryptedEntries: readonly ImportedEncryptedEntry[],
  now: Date,
): Promise<void> {
  await importEnvironmentVariableValues({
    changeEvent: buildImportVariableChangeEventInput(
      input,
      target,
      sensitivity,
      buildImportedFingerprints(encryptedEntries),
    ),
    values: buildImportedUpsertValues(input, target, sensitivity, encryptedEntries, now),
  });
}

function buildImportVariablesResult(input: ImportVariablesInput, target: VariableTargetContext): ImportVariablesResult {
  return {
    environment: target.environment,
    importedKeyNames: input.entries.map((entry: VariableImportEntry): string => entry.keyName),
    project: target.project,
    resourceName: target.resourceName,
    serviceName: target.serviceName,
  };
}

function buildImportedFingerprints(encryptedEntries: readonly ImportedEncryptedEntry[]): string[] {
  return encryptedEntries.map((entry: ImportedEncryptedEntry): string => entry.encryptedValue.valueFingerprint);
}

function buildImportedUpsertValues(
  input: ImportVariablesInput,
  target: VariableTargetContext,
  sensitivity: VariableSensitivity,
  encryptedEntries: readonly ImportedEncryptedEntry[],
  now: Date,
): UpsertEnvironmentVariableValueInput[] {
  return encryptedEntries.map(
    (entry: ImportedEncryptedEntry): UpsertEnvironmentVariableValueInput =>
      buildUpsertVariableInput(
        {
          ...input,
          keyName: entry.entry.keyName,
          value: entry.entry.value,
        },
        target,
        createId('var'),
        now,
        sensitivity,
        entry.encryptedValue,
      ),
  );
}
