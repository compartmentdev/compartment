import { createVariableCollisionError } from '../errors/api-business-error';
import type {
  EnvironmentVariableSetBindingRow,
  EnvironmentVariableValueRow,
  OrganizationVariableSetEntryRow,
  OrganizationVariableSetNameRow,
} from '../queries/variables.query.types';
import type { ListedVariable, StoredEffectiveVariable } from './effective-variables.service.types';
import { readVariableTargetType, type VariableTargetType } from './variable-target-type.helpers';

type EffectiveScopeType = VariableTargetType;

interface DirectVariableScopeTarget {
  inherited: boolean;
  projectServiceId: string | null;
  projectServiceName: string | null;
  targetResourceName: string | null;
}

interface VariableSetEntryScope {
  scopeResourceName: string | null;
  scopeServiceName: string | null;
  scopeType: EffectiveScopeType;
}

export function appendVariableSetScope(
  effectiveVariables: Map<string, StoredEffectiveVariable>,
  variableSetEntries: OrganizationVariableSetEntryRow[],
  variableSetIds: string[],
  scopeType: EffectiveScopeType,
  scopeResourceName: string | null,
  scopeServiceName: string | null,
  variableSetNamesById: ReadonlyMap<string, string>,
): void {
  const seenKeysByScope: Map<string, string> = new Map<string, string>();

  for (const variableSetId of variableSetIds) {
    appendVariableSetEntries(
      effectiveVariables,
      seenKeysByScope,
      listEntriesForVariableSet(variableSetEntries, variableSetId),
      readVariableSetLabel(variableSetId, variableSetNamesById),
      { scopeResourceName, scopeServiceName, scopeType },
    );
  }
}

export function appendDirectVariableScope(
  effectiveVariables: Map<string, StoredEffectiveVariable>,
  variableValues: EnvironmentVariableValueRow[],
  projectServiceId: string | null,
  projectServiceName: string | null,
  targetResourceName: string | null,
  inherited: boolean,
): void {
  const target: DirectVariableScopeTarget = {
    inherited,
    projectServiceId,
    projectServiceName,
    targetResourceName,
  };

  for (const variableValue of variableValues.filter((row: EnvironmentVariableValueRow): boolean =>
    isDirectVariableScopeMatch(row, target),
  )) {
    effectiveVariables.set(variableValue.keyName, buildDirectEffectiveVariable(variableValue, target));
  }
}

function buildDirectEffectiveVariable(
  variableValue: EnvironmentVariableValueRow,
  target: DirectVariableScopeTarget,
): StoredEffectiveVariable {
  return {
    encryptionKeyId: variableValue.encryptionKeyId,
    keyName: variableValue.keyName,
    scopeResourceName: target.targetResourceName,
    scopeServiceName: target.projectServiceName,
    scopeType: readVariableTargetType({
      resourceName: target.targetResourceName,
      serviceName: target.projectServiceName,
    }),
    sensitivity: variableValue.sensitivity,
    sourceResourceOutput: null,
    sourceType: target.inherited ? 'inherited' : 'direct',
    sourceVariableSetName: null,
    valueCiphertext: variableValue.valueCiphertext,
    valueFingerprint: variableValue.valueFingerprint,
    valuePlaintext: null,
  };
}

function isDirectVariableScopeMatch(row: EnvironmentVariableValueRow, target: DirectVariableScopeTarget): boolean {
  return row.projectServiceId === target.projectServiceId && row.targetResourceName === target.targetResourceName;
}

export function collectBoundVariableSetIds(
  variableSetBindings: EnvironmentVariableSetBindingRow[],
  projectServiceId: string | null,
  includeEnvironmentScope: boolean,
  targetResourceName: string | null = null,
): string[] {
  return variableSetBindings
    .filter((binding: EnvironmentVariableSetBindingRow): boolean =>
      isBoundVariableSetMatch(binding, projectServiceId, includeEnvironmentScope, targetResourceName),
    )
    .map((binding: EnvironmentVariableSetBindingRow): string => binding.organizationVariableSetId);
}

export function createVariableSetNamesById(variableSetNames: OrganizationVariableSetNameRow[]): Map<string, string> {
  return new Map<string, string>(
    variableSetNames.map((row: OrganizationVariableSetNameRow): [string, string] => [row.id, row.name]),
  );
}

export function compareEffectiveVariables(left: ListedVariable, right: ListedVariable): number {
  return left.keyName.localeCompare(right.keyName);
}

function isBoundVariableSetMatch(
  binding: EnvironmentVariableSetBindingRow,
  projectServiceId: string | null,
  includeEnvironmentScope: boolean,
  targetResourceName: string | null,
): boolean {
  if (targetResourceName !== null) {
    return binding.projectServiceId === null && binding.targetResourceName === targetResourceName;
  }

  return (
    (binding.projectServiceId === projectServiceId && binding.targetResourceName === null) ||
    (includeEnvironmentScope &&
      projectServiceId !== null &&
      binding.projectServiceId === null &&
      binding.targetResourceName === null)
  );
}

function listEntriesForVariableSet(
  variableSetEntries: OrganizationVariableSetEntryRow[],
  variableSetId: string,
): OrganizationVariableSetEntryRow[] {
  return variableSetEntries.filter(
    (entry: OrganizationVariableSetEntryRow): boolean => entry.organizationVariableSetId === variableSetId,
  );
}

function appendVariableSetEntries(
  effectiveVariables: Map<string, StoredEffectiveVariable>,
  seenKeysByScope: Map<string, string>,
  entries: OrganizationVariableSetEntryRow[],
  sourceLabel: string,
  scope: VariableSetEntryScope,
): void {
  for (const entry of entries) {
    assertNoVariableSetConflict(seenKeysByScope, entry.keyName, sourceLabel, scope.scopeType);
    effectiveVariables.set(entry.keyName, buildSetEffectiveVariable(entry, sourceLabel, scope));
    seenKeysByScope.set(entry.keyName, sourceLabel);
  }
}

function buildSetEffectiveVariable(
  entry: OrganizationVariableSetEntryRow,
  sourceLabel: string,
  scope: VariableSetEntryScope,
): StoredEffectiveVariable {
  return {
    encryptionKeyId: entry.encryptionKeyId,
    keyName: entry.keyName,
    scopeResourceName: scope.scopeResourceName,
    scopeServiceName: scope.scopeServiceName,
    scopeType: scope.scopeType,
    sensitivity: entry.sensitivity,
    sourceResourceOutput: null,
    sourceType: 'set',
    sourceVariableSetName: sourceLabel,
    valueCiphertext: entry.valueCiphertext,
    valueFingerprint: entry.valueFingerprint,
    valuePlaintext: null,
  };
}

function assertNoVariableSetConflict(
  seenKeysByScope: Map<string, string>,
  keyName: string,
  nextSourceLabel: string,
  scopeType: EffectiveScopeType,
): void {
  const previousSourceLabel: string | undefined = seenKeysByScope.get(keyName);
  if (previousSourceLabel !== undefined) {
    throw createVariableCollisionError(
      buildVariableSetConflictMessage(scopeType, keyName, previousSourceLabel, nextSourceLabel),
    );
  }
}

function buildVariableSetConflictMessage(
  scopeType: EffectiveScopeType,
  keyName: string,
  previousSourceLabel: string,
  nextSourceLabel: string,
): string {
  return [
    `Conflicting ${scopeType}-scoped variable "${keyName}"`,
    `from variable sets "${previousSourceLabel}" and "${nextSourceLabel}".`,
  ].join(' ');
}

function readVariableSetLabel(variableSetId: string, variableSetNamesById: ReadonlyMap<string, string>): string {
  return variableSetNamesById.get(variableSetId) ?? variableSetId;
}
