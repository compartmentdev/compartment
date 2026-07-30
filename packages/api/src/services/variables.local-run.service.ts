import { defaultCompartmentEnvironmentName, variableKeyNameSchema } from '@compartment/contracts';
import { createInvalidVariableLocalRunError } from '../errors/api-business-error';
import { createId } from '../lib/tokens';
import { decryptTenantVariableValueFromStorage } from '../lib/variables-crypto';
import { insertVariableAccessEvent } from '../queries/variables.query';
import type { InsertVariableAccessEventInput, VariableAccessEventRow } from '../queries/variables.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import { loadStoredEffectiveVariables } from './effective-variables.service';
import type { StoredEffectiveVariable } from './effective-variables.service.types';
import { resolveReadVariableTarget } from './variables.target.service';
import { buildLoadEffectiveVariablesInput } from './variables.service.helpers';
import type {
  VariableLocalRunInput,
  VariableLocalRunResult,
  VariableLocalRunValue,
  VariableTargetContext,
  VariableTargetInput,
} from './variables.service.types';

export async function loadVariablesForLocalRun(input: VariableLocalRunInput): Promise<VariableLocalRunResult> {
  const target: VariableTargetContext = await resolveReadVariableTarget(
    buildVariableTargetInput(input),
    'variable.local_run',
  );
  const variables: StoredEffectiveVariable[] = await loadStoredVariablesForLocalRun(target);
  assertStoredVariablesAllowedForLocalRun(variables);
  const accessEvent: VariableAccessEventRow = await insertVariableAccessEvent(
    buildVariableAccessEventInput(input, target, variables),
  );

  return {
    accessEventId: accessEvent.id,
    environment: target.environment,
    project: target.project,
    resourceName: target.resourceName,
    serviceName: target.serviceName,
    variables: variables.map(decryptLocalRunVariable),
  };
}

async function loadStoredVariablesForLocalRun(target: VariableTargetContext): Promise<StoredEffectiveVariable[]> {
  return await loadStoredEffectiveVariables(buildLoadEffectiveVariablesInput(target));
}

function buildVariableTargetInput(input: VariableLocalRunInput): VariableTargetInput {
  return {
    environmentName: input.environmentName,
    organizationSlug: input.organizationSlug,
    principalId: input.principalId,
    projectName: input.projectName,
    resourceName: input.resourceName ?? undefined,
    serviceName: input.serviceName ?? undefined,
  };
}

function assertStoredVariablesAllowedForLocalRun(variables: readonly StoredEffectiveVariable[]): void {
  const invalidVariable: StoredEffectiveVariable | undefined = variables.find(
    (variable: StoredEffectiveVariable): boolean => !variableKeyNameSchema.safeParse(variable.keyName).success,
  );
  if (invalidVariable !== undefined) {
    throw createInvalidVariableLocalRunError(`Variable "${invalidVariable.keyName}" cannot be injected locally.`);
  }
}

function buildVariableAccessEventInput(
  input: VariableLocalRunInput,
  target: VariableTargetContext,
  variables: readonly StoredEffectiveVariable[],
): InsertVariableAccessEventInput {
  return {
    actorPrincipalId: input.principalId,
    commandName: input.commandName ?? null,
    environmentId: target.environment.id,
    fingerprintsJson: JSON.stringify(buildVariableFingerprintMap(variables)),
    id: createId('vae'),
    keyNamesJson: JSON.stringify(variables.map((variable: StoredEffectiveVariable): string => variable.keyName)),
    operation: 'local_run',
    organizationId: target.organization.id,
    production: target.environment.name === defaultCompartmentEnvironmentName,
    projectId: target.project.id,
    projectServiceId: target.service?.id ?? null,
    targetResourceName: target.resourceName,
    sensitivityJson: JSON.stringify(buildVariableSensitivityMap(variables)),
    targetEnvironmentName: target.environment.name,
    targetProjectName: target.project.name,
    targetServiceName: target.serviceName,
  };
}

function buildVariableSensitivityMap(variables: readonly StoredEffectiveVariable[]): Record<string, string> {
  return Object.fromEntries(
    variables.map((variable: StoredEffectiveVariable): [string, string] => [variable.keyName, variable.sensitivity]),
  );
}

function buildVariableFingerprintMap(variables: readonly StoredEffectiveVariable[]): Record<string, string> {
  return Object.fromEntries(
    variables.map((variable: StoredEffectiveVariable): [string, string] => [
      variable.keyName,
      variable.valueFingerprint,
    ]),
  );
}

function decryptLocalRunVariable(variable: StoredEffectiveVariable): VariableLocalRunValue {
  return {
    keyName: variable.keyName,
    scopeResourceName: variable.scopeResourceName,
    scopeServiceName: variable.scopeServiceName,
    scopeType: variable.scopeType,
    sensitivity: variable.sensitivity,
    sourceResourceOutput: variable.sourceResourceOutput,
    sourceType: variable.sourceType,
    sourceVariableSetName: variable.sourceVariableSetName,
    value: variable.valuePlaintext ?? decryptStoredLocalRunVariable(variable),
    valueFingerprint: variable.valueFingerprint,
  };
}

function decryptStoredLocalRunVariable(variable: StoredEffectiveVariable): string {
  if (variable.valueCiphertext === null || variable.encryptionKeyId === null) {
    throw createInvalidVariableLocalRunError(`Variable "${variable.keyName}" cannot be injected locally.`);
  }

  return decryptTenantVariableValueFromStorage(
    variable.valueCiphertext,
    variable.encryptionKeyId,
    getApiConfig().tenantSecretsKek,
    getApiConfig().tenantSecretsPreviousKek,
  );
}
