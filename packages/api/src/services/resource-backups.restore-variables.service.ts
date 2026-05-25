import type { VariableSensitivity } from '@compartment/contracts';
import { createId } from '../lib/tokens';
import {
  decryptVariableValueFromStorage,
  encryptVariableValueForStorage,
  type EncryptedVariableValue,
} from '../lib/variables-crypto';
import type { ResourceTransaction } from '../queries/resources.query.types';
import {
  insertEnvironmentVariableValueIfMissingWithExecutor,
  insertVariableChangeEventWithExecutor,
  type InsertEnvironmentVariableValueIfMissingResult,
} from '../queries/variables.query.write.helpers';
import type { UpsertEnvironmentVariableValueInput } from '../queries/variables.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import { compareEffectiveVariables } from './effective-variables-resolution.helpers';
import type { EffectiveVariable } from './effective-variables.service.types';
import {
  buildDirectResourceEffectiveVariable,
  loadResourceEffectiveVariables,
} from './resources-effective-variables.service';
import type { ResourceEnvironmentContext } from './resources.service.types';
import { buildSetVariableChangeEventRecord } from './variables.service.write.helpers';

interface CopyRestoreResourceVariablesInput {
  actorPrincipalId: string;
  context: ResourceEnvironmentContext;
  sourceResourceName: string;
  targetResourceName: string;
  tx: ResourceTransaction;
}

interface ResourceVariableCopyPlan {
  keyName: string;
  sensitivity: VariableSensitivity;
  value: string;
}

interface PersistResourceVariableCopyInput extends CopyRestoreResourceVariablesInput {
  effectiveVariables: EffectiveVariable[];
  plan: ResourceVariableCopyPlan;
}

export async function copyRestoreResourceVariables(
  input: CopyRestoreResourceVariablesInput,
): Promise<EffectiveVariable[]> {
  const targetVariables: EffectiveVariable[] = await loadResourceEffectiveVariables(
    input.context.environment.id,
    input.context.organization.id,
    input.targetResourceName,
  );
  const copyPlans: ResourceVariableCopyPlan[] = await listResourceVariableCopyPlans(input, targetVariables);

  let effectiveVariables: EffectiveVariable[] = targetVariables;
  for (const plan of copyPlans) {
    effectiveVariables = await persistCopiedResourceVariable({
      ...input,
      effectiveVariables,
      plan,
    });
  }

  return effectiveVariables;
}

async function listResourceVariableCopyPlans(
  input: CopyRestoreResourceVariablesInput,
  targetVariables: readonly EffectiveVariable[],
): Promise<ResourceVariableCopyPlan[]> {
  const targetKeyNames: Set<string> = createVariableKeyNameSet(targetVariables);
  const sourceVariables: EffectiveVariable[] = await loadSourceResourceVariables(input);

  return sourceVariables
    .filter(
      (variable: EffectiveVariable): boolean =>
        isDirectResourceVariable(variable, input.sourceResourceName) && !targetKeyNames.has(variable.keyName),
    )
    .map(
      (variable: EffectiveVariable): ResourceVariableCopyPlan => ({
        keyName: variable.keyName,
        sensitivity: variable.sensitivity,
        value: variable.value,
      }),
    )
    .sort((left: ResourceVariableCopyPlan, right: ResourceVariableCopyPlan): number =>
      left.keyName.localeCompare(right.keyName),
    );
}

function createVariableKeyNameSet(variables: readonly EffectiveVariable[]): Set<string> {
  return new Set<string>(variables.map((variable: EffectiveVariable): string => variable.keyName));
}

async function loadSourceResourceVariables(input: CopyRestoreResourceVariablesInput): Promise<EffectiveVariable[]> {
  return await loadResourceEffectiveVariables(
    input.context.environment.id,
    input.context.organization.id,
    input.sourceResourceName,
  );
}

function isDirectResourceVariable(variable: EffectiveVariable, resourceName: string): boolean {
  return (
    variable.scopeResourceName === resourceName && variable.scopeType === 'resource' && variable.sourceType === 'direct'
  );
}

async function persistCopiedResourceVariable(input: PersistResourceVariableCopyInput): Promise<EffectiveVariable[]> {
  const encryptedValue: EncryptedVariableValue = encryptVariableValueForStorage(
    input.plan.value,
    getApiConfig().variablesMasterKey,
  );
  const result: InsertEnvironmentVariableValueIfMissingResult =
    await insertEnvironmentVariableValueIfMissingWithExecutor(
      input.tx,
      buildCopiedResourceVariableInput(input, encryptedValue, new Date()),
    );

  if (result.created) {
    await insertCopiedResourceVariableChangeEvent(input, encryptedValue);
  }

  return sortEffectiveVariables([
    ...input.effectiveVariables,
    buildDirectResourceEffectiveVariable({
      keyName: input.plan.keyName,
      resourceName: input.targetResourceName,
      row: result.row,
      value: readCopiedVariablePlaintext(result, input.plan.value),
    }),
  ]);
}

async function insertCopiedResourceVariableChangeEvent(
  input: PersistResourceVariableCopyInput,
  encryptedValue: EncryptedVariableValue,
): Promise<void> {
  await insertVariableChangeEventWithExecutor(
    input.tx,
    buildSetVariableChangeEventRecord({
      actorPrincipalId: input.actorPrincipalId,
      encryptedValue,
      keyName: input.plan.keyName,
      organizationId: input.context.organization.id,
      sensitivity: input.plan.sensitivity,
      targetId: input.targetResourceName,
      targetType: 'resource',
    }),
  );
}

function buildCopiedResourceVariableInput(
  input: PersistResourceVariableCopyInput,
  encryptedValue: EncryptedVariableValue,
  now: Date,
): UpsertEnvironmentVariableValueInput {
  return {
    createdByPrincipalId: input.actorPrincipalId,
    encryptionKeyId: encryptedValue.encryptionKeyId,
    environmentId: input.context.environment.id,
    id: createId('var'),
    keyName: input.plan.keyName,
    projectServiceId: null,
    sensitivity: input.plan.sensitivity,
    targetResourceName: input.targetResourceName,
    updatedAt: now,
    updatedByPrincipalId: input.actorPrincipalId,
    valueCiphertext: encryptedValue.valueCiphertext,
    valueFingerprint: encryptedValue.valueFingerprint,
  };
}

function readCopiedVariablePlaintext(
  result: InsertEnvironmentVariableValueIfMissingResult,
  copiedValue: string,
): string {
  return result.created
    ? copiedValue
    : decryptVariableValueFromStorage(
        result.row.valueCiphertext,
        result.row.encryptionKeyId,
        getApiConfig().variablesMasterKey,
      );
}

function sortEffectiveVariables(effectiveVariables: EffectiveVariable[]): EffectiveVariable[] {
  return effectiveVariables.sort(compareEffectiveVariables);
}
