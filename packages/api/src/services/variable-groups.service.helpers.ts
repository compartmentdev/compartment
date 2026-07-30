import type { VariableImportEntry } from '@compartment/contracts';
import { createVariableCollisionError, createVariableGroupNotFoundError } from '../errors/api-business-error';
import { decryptTenantVariableValueFromStorage, type EncryptedVariableValue } from '../lib/variables-crypto';
import { isUniqueConstraintError, readConstraintName } from '../queries/query-error';
import type { VariableGroupRow, VariableGroupSummaryRow } from '../queries/variable-groups.query.types';
import { findVariableGroupByName } from '../queries/variable-groups.query';
import { listEnvironmentVariableValues, listOrganizationVariableSetEntriesForSetIds } from '../queries/variables.query';
import type { EnvironmentVariableValueRow, OrganizationVariableSetEntryRow } from '../queries/variables.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import { loadEffectiveVariables } from './effective-variables.service';
import type { EffectiveVariable } from './effective-variables.service.types';
import { readVariableTargetType } from './variable-target-type.helpers';
import type {
  CapturedVariableValue,
  LoadedVariableGroup,
  VariableGroupBindingTargetContext,
  VariableGroupDetailResult,
  VariableGroupSummaryResult,
  VariableGroupVariableResult,
} from './variable-groups.service.types';

const variableGroupNameUniqueConstraint: string = 'organization_variable_sets_organization_id_name_unique';

export async function loadVariableGroup(
  organizationId: string,
  variableGroupName: string,
): Promise<LoadedVariableGroup> {
  const variableGroup: LoadedVariableGroup | null = await findLoadedVariableGroup(organizationId, variableGroupName);
  if (variableGroup === null) {
    throw createVariableGroupNotFoundError();
  }

  return variableGroup;
}

export async function findLoadedVariableGroup(
  organizationId: string,
  variableGroupName: string,
): Promise<LoadedVariableGroup | null> {
  const variableGroup: VariableGroupRow | undefined = await findVariableGroupByName(organizationId, variableGroupName);
  if (variableGroup === undefined) {
    return null;
  }

  const variables: OrganizationVariableSetEntryRow[] = await listOrganizationVariableSetEntriesForSetIds(
    [variableGroup.id],
    organizationId,
  );

  return {
    ...variableGroup,
    variables,
  };
}

export async function loadDirectCapturedVariables(
  target: VariableGroupBindingTargetContext,
): Promise<CapturedVariableValue[]> {
  const variableValues: EnvironmentVariableValueRow[] = await listEnvironmentVariableValues(target.environment.id);
  const targetServiceId: string | null = target.service === null ? null : target.service.id;
  const filteredValues: EnvironmentVariableValueRow[] = variableValues.filter(
    (variable: EnvironmentVariableValueRow): boolean =>
      variable.projectServiceId === targetServiceId && variable.targetResourceName === target.resourceName,
  );

  return filteredValues.map(
    (variable: EnvironmentVariableValueRow): CapturedVariableValue => ({
      keyName: variable.keyName,
      sensitivity: variable.sensitivity,
      value: decryptTenantVariableValueFromStorage(
        variable.valueCiphertext,
        variable.encryptionKeyId,
        getApiConfig().tenantSecretsKek,
        getApiConfig().tenantSecretsPreviousKek,
      ),
    }),
  );
}

export async function loadEffectiveCapturedVariables(
  target: VariableGroupBindingTargetContext,
  organizationId: string,
): Promise<CapturedVariableValue[]> {
  const variables: EffectiveVariable[] = await loadEffectiveVariables({
    environmentId: target.environment.id,
    environmentName: target.environment.name,
    organizationId,
    projectName: target.project.name,
    targetResourceName: target.resourceName,
    targetServiceId: target.service?.id ?? null,
    targetServiceName: target.serviceName,
    targetType: readVariableTargetType({
      resourceName: target.resourceName,
      serviceName: target.serviceName,
    }),
  });

  return variables.map(
    (variable: EffectiveVariable): CapturedVariableValue => ({
      keyName: variable.keyName,
      sensitivity: variable.sensitivity,
      value: variable.value,
    }),
  );
}

export function buildVariableGroupSummaryResult(input: VariableGroupSummaryRow): VariableGroupSummaryResult {
  return {
    createdAt: input.createdAt,
    description: input.description,
    name: input.name,
    updatedAt: input.updatedAt,
    variableCount: input.variableCount,
  };
}

export function buildVariableGroupDetailResult(variableGroup: LoadedVariableGroup): VariableGroupDetailResult {
  return {
    createdAt: variableGroup.createdAt,
    description: variableGroup.description,
    name: variableGroup.name,
    updatedAt: variableGroup.updatedAt,
    variableCount: variableGroup.variables.length,
    variables: variableGroup.variables.map(buildVariableGroupVariableResult),
  };
}

export function handleDuplicateVariableGroupName(error: Error, variableGroupName: string): void {
  if (!isUniqueConstraintError(error)) {
    return;
  }
  if (readConstraintName(error) !== variableGroupNameUniqueConstraint) {
    return;
  }

  throw createVariableCollisionError(`Variable group ${variableGroupName} already exists.`);
}

export function readVariableGroupImportConflicts(
  entries: readonly VariableImportEntry[],
  variableGroup: LoadedVariableGroup,
): string[] {
  const existingKeyNames: Set<string> = new Set<string>(
    variableGroup.variables.map((variable: OrganizationVariableSetEntryRow): string => variable.keyName),
  );

  return entries
    .filter((entry: VariableImportEntry): boolean => existingKeyNames.has(entry.keyName))
    .map((entry: VariableImportEntry): string => entry.keyName);
}

export function buildVariableGroupFingerprintsJson(encryptedValues: readonly EncryptedVariableValue[]): string {
  return JSON.stringify(
    encryptedValues.map((encryptedValue: EncryptedVariableValue): string => encryptedValue.valueFingerprint),
  );
}

function buildVariableGroupVariableResult(variable: OrganizationVariableSetEntryRow): VariableGroupVariableResult {
  return {
    keyName: variable.keyName,
    sensitivity: variable.sensitivity,
  };
}
