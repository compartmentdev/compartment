import { randomBytes } from 'node:crypto';
import {
  resourceGeneratedVariableTokenDefaultBytes,
  resourceGeneratedVariableTokenDefaultEncoding,
  type CompartmentAuthoredResourceConfig,
  type CompartmentResourceGeneratedVariableConfig,
} from '@compartment/contracts';
import { createId } from '../lib/tokens';
import {
  decryptTenantVariableValueFromStorage,
  encryptTenantVariableValueForStorage,
  type EncryptedVariableValue,
} from '../lib/variables-crypto';
import {
  insertEnvironmentVariableValueIfMissingWithExecutor,
  insertVariableChangeEventWithExecutor,
  type InsertEnvironmentVariableValueIfMissingResult,
} from '../queries/variables.query.write.helpers';
import type { UpsertEnvironmentVariableValueInput } from '../queries/variables.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import { compareEffectiveVariables } from './effective-variables-resolution.helpers';
import type { EffectiveVariable } from './effective-variables.service.types';
import { buildDirectResourceEffectiveVariable } from './resources-effective-variables.service';
import type { ResourceEnvironmentContext } from './resources.service.types';
import { buildSetVariableChangeEventRecord } from './variables.service.write.helpers';
import type { ResourceTransaction } from '../queries/resources.query.types';

interface EnsureGeneratedResourceVariablesInput {
  actorPrincipalId: string;
  context: ResourceEnvironmentContext;
  effectiveVariables: EffectiveVariable[];
  resource: CompartmentAuthoredResourceConfig;
  resourceName: string;
  tx: ResourceTransaction;
}

interface GeneratedResourceVariablePlan {
  config: CompartmentResourceGeneratedVariableConfig;
  keyName: string;
}

interface PersistGeneratedResourceVariableInput extends EnsureGeneratedResourceVariablesInput {
  plan: GeneratedResourceVariablePlan;
}

export async function ensureGeneratedResourceVariables(
  input: EnsureGeneratedResourceVariablesInput,
): Promise<EffectiveVariable[]> {
  const missingVariables: GeneratedResourceVariablePlan[] = listMissingGeneratedVariables(
    input.resource,
    input.effectiveVariables,
  );
  if (missingVariables.length === 0) {
    return input.effectiveVariables;
  }

  let effectiveVariables: EffectiveVariable[] = input.effectiveVariables;
  for (const plan of missingVariables) {
    effectiveVariables = await persistGeneratedResourceVariable({
      ...input,
      effectiveVariables,
      plan,
    });
  }

  return effectiveVariables;
}

async function persistGeneratedResourceVariable(
  input: PersistGeneratedResourceVariableInput,
): Promise<EffectiveVariable[]> {
  const secretValue: string = createGeneratedResourceVariableValue(input.plan.config);
  const encryptedValue: EncryptedVariableValue = encryptGeneratedVariableValue(secretValue);
  const result: InsertEnvironmentVariableValueIfMissingResult = await insertGeneratedResourceVariable(
    input,
    encryptedValue,
  );

  if (result.created) {
    await insertGeneratedResourceVariableChangeEvent(input, encryptedValue);
  }

  return sortEffectiveVariables([
    ...input.effectiveVariables,
    buildDirectResourceEffectiveVariable({
      keyName: input.plan.keyName,
      resourceName: input.resourceName,
      row: result.row,
      value: readGeneratedVariablePlaintext(result, secretValue),
    }),
  ]);
}

function listMissingGeneratedVariables(
  resource: CompartmentAuthoredResourceConfig,
  effectiveVariables: readonly EffectiveVariable[],
): GeneratedResourceVariablePlan[] {
  const effectiveKeyNames: Set<string> = new Set<string>(
    effectiveVariables.map((variable: EffectiveVariable): string => variable.keyName),
  );

  return Object.entries(resource.generatedVariables ?? {})
    .filter(
      ([keyName]: [string, CompartmentResourceGeneratedVariableConfig]): boolean => !effectiveKeyNames.has(keyName),
    )
    .map(
      ([keyName, config]: [string, CompartmentResourceGeneratedVariableConfig]): GeneratedResourceVariablePlan => ({
        config,
        keyName,
      }),
    )
    .sort((left: GeneratedResourceVariablePlan, right: GeneratedResourceVariablePlan): number =>
      left.keyName.localeCompare(right.keyName),
    );
}

function createGeneratedResourceVariableValue(config: CompartmentResourceGeneratedVariableConfig): string {
  return randomBytes(config.bytes ?? resourceGeneratedVariableTokenDefaultBytes).toString(
    config.encoding ?? resourceGeneratedVariableTokenDefaultEncoding,
  );
}

function encryptGeneratedVariableValue(secretValue: string): EncryptedVariableValue {
  return encryptTenantVariableValueForStorage(
    secretValue,
    getApiConfig().tenantSecretsKek,
    getApiConfig().variablesMasterKey,
  );
}

async function insertGeneratedResourceVariable(
  input: PersistGeneratedResourceVariableInput,
  encryptedValue: EncryptedVariableValue,
): Promise<InsertEnvironmentVariableValueIfMissingResult> {
  return await insertEnvironmentVariableValueIfMissingWithExecutor(
    input.tx,
    buildGeneratedResourceVariableInput(input, encryptedValue, new Date()),
  );
}

async function insertGeneratedResourceVariableChangeEvent(
  input: PersistGeneratedResourceVariableInput,
  encryptedValue: EncryptedVariableValue,
): Promise<void> {
  await insertVariableChangeEventWithExecutor(
    input.tx,
    buildSetVariableChangeEventRecord({
      actorPrincipalId: input.actorPrincipalId,
      encryptedValue,
      keyName: input.plan.keyName,
      organizationId: input.context.organization.id,
      sensitivity: 'sensitive',
      targetId: input.resourceName,
      targetType: 'resource',
    }),
  );
}

function buildGeneratedResourceVariableInput(
  input: PersistGeneratedResourceVariableInput,
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
    sensitivity: 'sensitive',
    targetResourceName: input.resourceName,
    updatedAt: now,
    updatedByPrincipalId: input.actorPrincipalId,
    valueCiphertext: encryptedValue.valueCiphertext,
    valueFingerprint: encryptedValue.valueFingerprint,
  };
}

function readGeneratedVariablePlaintext(
  result: InsertEnvironmentVariableValueIfMissingResult,
  generatedSecretValue: string,
): string {
  return result.created
    ? generatedSecretValue
    : decryptTenantVariableValueFromStorage(
        result.row.valueCiphertext,
        result.row.encryptionKeyId,
        getApiConfig().tenantSecretsKek,
        getApiConfig().tenantSecretsPreviousKek,
      );
}

function sortEffectiveVariables(effectiveVariables: EffectiveVariable[]): EffectiveVariable[] {
  return effectiveVariables.sort(compareEffectiveVariables);
}
