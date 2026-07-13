import { buildResourceOutputReference } from '@compartment/contracts';
import { decryptVariableValueFromStorage } from '../lib/variables-crypto';
import {
  listEnvironmentVariableSetBindings,
  listEnvironmentVariableValues,
  listOrganizationVariableSetEntriesForSetIds,
  listOrganizationVariableSetNamesByIds,
} from '../queries/variables.query';
import { listEnvironmentResourceOutputVariableBindings } from '../queries/variables-resource-output.query';
import type {
  EnvironmentResourceOutputVariableBindingRow,
  EnvironmentVariableSetBindingRow,
  EnvironmentVariableValueRow,
} from '../queries/variables.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import { findProjectResourceByName } from '../queries/resources.query';
import type { ProjectResourceRow } from '../queries/resources.query.types';
import { collectBoundVariableSetIds, resolveStoredEffectiveVariables } from './effective-variables-resolution.service';
import type {
  EffectiveVariable,
  EffectiveVariableQueryRows,
  LoadEffectiveVariablesInput,
  LoadEffectiveVariablesForBuildEnvOptions,
  StoredEffectiveVariable,
} from './effective-variables.service.types';
import {
  resolveResourceOutputPlaintext,
  type ResolvedResourceOutputPlaintext,
} from './resource-output-resolution.service';
import { resolveResourceOutputNamespaceId } from './resource-output-namespace.service';
import { createInvalidDeployConfigError } from '../errors/api-business-error';

export async function loadEffectiveVariables(input: LoadEffectiveVariablesInput): Promise<EffectiveVariable[]> {
  const storedVariables: StoredEffectiveVariable[] = await loadStoredEffectiveVariables(input);
  return storedVariables.map(decryptStoredEffectiveVariable);
}

export async function loadStoredEffectiveVariables(
  input: LoadEffectiveVariablesInput,
): Promise<StoredEffectiveVariable[]> {
  const rows: EffectiveVariableQueryRows = await loadEffectiveVariableRows(input);
  const variables: StoredEffectiveVariable[] = resolveStoredEffectiveVariables(input, rows);
  if (input.targetType !== 'service') {
    return variables;
  }

  return await appendResourceOutputVariables(input, rows, variables);
}

export async function loadStoredEffectiveVariablesForBuildEnv(
  input: LoadEffectiveVariablesInput,
  keyNames: readonly string[],
  options: LoadEffectiveVariablesForBuildEnvOptions = { ignoredDescriptorResourceOutputBindingKeyNames: [] },
): Promise<StoredEffectiveVariable[]> {
  const rows: EffectiveVariableQueryRows = await loadEffectiveVariableRows(input);
  const variables: StoredEffectiveVariable[] = resolveStoredEffectiveVariables(input, rows);
  if (input.targetType !== 'service' || keyNames.length === 0) {
    return variables;
  }

  return appendSelectedResourceOutputBuildVariables(input, rows, variables, keyNames, options);
}

async function loadEffectiveVariableRows(input: LoadEffectiveVariablesInput): Promise<EffectiveVariableQueryRows> {
  const [variableValues, variableSetBindings, resourceOutputVariableBindings]: [
    EnvironmentVariableValueRow[],
    EnvironmentVariableSetBindingRow[],
    EnvironmentResourceOutputVariableBindingRow[],
  ] = await Promise.all([
    listEnvironmentVariableValues(input.environmentId),
    listEnvironmentVariableSetBindings(input.environmentId, input.organizationId),
    listEnvironmentResourceOutputVariableBindings(input.environmentId),
  ]);
  const boundVariableSetIds: string[] = collectBoundVariableSetIds(
    variableSetBindings,
    input.targetServiceId,
    input.targetType === 'service',
    input.targetResourceName,
  );

  return {
    resourceOutputVariableBindings,
    variableSetBindings,
    variableSetEntries: await listOrganizationVariableSetEntriesForSetIds(boundVariableSetIds, input.organizationId),
    variableSetNames: await listOrganizationVariableSetNamesByIds(boundVariableSetIds, input.organizationId),
    variableValues,
  };
}

function decryptStoredEffectiveVariable(variable: StoredEffectiveVariable): EffectiveVariable {
  return {
    ...variable,
    value: variable.valuePlaintext ?? decryptRequiredStoredValue(variable),
  };
}

async function appendResourceOutputVariables(
  input: LoadEffectiveVariablesInput,
  rows: EffectiveVariableQueryRows,
  variables: StoredEffectiveVariable[],
): Promise<StoredEffectiveVariable[]> {
  const effectiveVariables: Map<string, StoredEffectiveVariable> = buildStoredEffectiveVariableMap(variables);
  const serviceBindings: EnvironmentResourceOutputVariableBindingRow[] = rows.resourceOutputVariableBindings.filter(
    (binding: EnvironmentResourceOutputVariableBindingRow): boolean =>
      binding.targetServiceName === input.targetServiceName,
  );

  for (const binding of serviceBindings) {
    assertNoDirectServiceOutputBindingConflict(effectiveVariables, binding);
    effectiveVariables.set(binding.keyName, await resolveResourceOutputVariable(input, rows, binding));
  }

  return [...effectiveVariables.values()];
}

function appendSelectedResourceOutputBuildVariables(
  input: LoadEffectiveVariablesInput,
  rows: EffectiveVariableQueryRows,
  variables: StoredEffectiveVariable[],
  keyNames: readonly string[],
  options: LoadEffectiveVariablesForBuildEnvOptions,
): StoredEffectiveVariable[] {
  const effectiveVariables: Map<string, StoredEffectiveVariable> = buildStoredEffectiveVariableMap(variables);
  const selectedKeyNames: Set<string> = new Set<string>(keyNames);
  const ignoredDescriptorKeyNames: ReadonlySet<string> = new Set<string>(
    options.ignoredDescriptorResourceOutputBindingKeyNames,
  );
  const selectedBindings: EnvironmentResourceOutputVariableBindingRow[] = rows.resourceOutputVariableBindings.filter(
    (binding: EnvironmentResourceOutputVariableBindingRow): boolean =>
      binding.targetServiceName === input.targetServiceName &&
      selectedKeyNames.has(binding.keyName) &&
      !(binding.source === 'descriptor' && ignoredDescriptorKeyNames.has(binding.keyName)),
  );

  for (const binding of selectedBindings) {
    assertNoDirectServiceOutputBindingConflict(effectiveVariables, binding);
    effectiveVariables.set(binding.keyName, buildUnresolvedResourceOutputVariable(binding));
  }

  return [...effectiveVariables.values()];
}

function buildStoredEffectiveVariableMap(
  variables: readonly StoredEffectiveVariable[],
): Map<string, StoredEffectiveVariable> {
  return new Map<string, StoredEffectiveVariable>(
    variables.map((variable: StoredEffectiveVariable): [string, StoredEffectiveVariable] => [
      variable.keyName,
      variable,
    ]),
  );
}

async function resolveResourceOutputVariable(
  input: LoadEffectiveVariablesInput,
  rows: EffectiveVariableQueryRows,
  binding: EnvironmentResourceOutputVariableBindingRow,
): Promise<StoredEffectiveVariable> {
  const resource: ProjectResourceRow = await resolveResourceOutputBindingResource(input, binding);
  const namespaceId: string = await resolveResourceOutputNamespaceId(resource, input.environmentId);
  const resourceVariables: EffectiveVariable[] = resolveStoredEffectiveVariables(
    buildResourceOutputVariableLoadInput(input, binding),
    rows,
  ).map(decryptStoredEffectiveVariable);
  const output: ResolvedResourceOutputPlaintext = resolveResourceOutputPlaintext(
    resource,
    binding.outputName,
    input.projectName,
    input.environmentName,
    namespaceId,
    resourceVariables,
  );

  return buildStoredResourceOutputVariable(binding, output);
}

function buildResourceOutputVariableLoadInput(
  input: LoadEffectiveVariablesInput,
  binding: EnvironmentResourceOutputVariableBindingRow,
): LoadEffectiveVariablesInput {
  return {
    ...input,
    targetResourceName: binding.resourceName,
    targetServiceId: null,
    targetServiceName: null,
    targetType: 'resource',
  };
}

async function resolveResourceOutputBindingResource(
  input: LoadEffectiveVariablesInput,
  binding: EnvironmentResourceOutputVariableBindingRow,
): Promise<ProjectResourceRow> {
  const resource: ProjectResourceRow | undefined = await findProjectResourceByName(
    input.environmentId,
    binding.resourceName,
  );
  if (resource === undefined) {
    throw createInvalidDeployConfigError(
      `Resource output variable "${binding.keyName}" references missing resource "${binding.resourceName}".`,
    );
  }

  return resource;
}

function buildStoredResourceOutputVariable(
  binding: EnvironmentResourceOutputVariableBindingRow,
  output: ResolvedResourceOutputPlaintext,
): StoredEffectiveVariable {
  const outputReference: string = buildResourceOutputReference(binding);

  return {
    encryptionKeyId: null,
    keyName: binding.keyName,
    scopeResourceName: null,
    scopeServiceName: binding.targetServiceName,
    scopeType: 'service',
    sensitivity: output.sensitivity,
    sourceResourceOutput: outputReference,
    sourceType: 'resource_output',
    sourceVariableSetName: null,
    valueCiphertext: null,
    valueFingerprint: output.valueFingerprint,
    valuePlaintext: output.value,
  };
}

function buildUnresolvedResourceOutputVariable(
  binding: EnvironmentResourceOutputVariableBindingRow,
): StoredEffectiveVariable {
  const outputReference: string = buildResourceOutputReference(binding);

  return {
    encryptionKeyId: null,
    keyName: binding.keyName,
    scopeResourceName: null,
    scopeServiceName: binding.targetServiceName,
    scopeType: 'service',
    sensitivity: 'sensitive',
    sourceResourceOutput: outputReference,
    sourceType: 'resource_output',
    sourceVariableSetName: null,
    valueCiphertext: null,
    valueFingerprint: outputReference,
    valuePlaintext: null,
  };
}

function assertNoDirectServiceOutputBindingConflict(
  variables: ReadonlyMap<string, StoredEffectiveVariable>,
  binding: EnvironmentResourceOutputVariableBindingRow,
): void {
  const existing: StoredEffectiveVariable | undefined = variables.get(binding.keyName);
  if (existing?.scopeType === 'service' && existing.sourceType !== 'set') {
    throw createInvalidDeployConfigError(
      `Conflicting service-scoped variable "${binding.keyName}" and resource output binding for service "${binding.targetServiceName}".`,
    );
  }
}

function decryptRequiredStoredValue(variable: StoredEffectiveVariable): string {
  if (variable.valueCiphertext === null || variable.encryptionKeyId === null) {
    throw createInvalidDeployConfigError(`Variable "${variable.keyName}" has no stored value.`);
  }

  return decryptStoredValue(variable.valueCiphertext, variable.encryptionKeyId);
}

function decryptStoredValue(valueCiphertext: string, encryptionKeyId: string): string {
  return decryptVariableValueFromStorage(valueCiphertext, encryptionKeyId, getApiConfig().variablesMasterKey);
}
