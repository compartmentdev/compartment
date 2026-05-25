import type { EnvironmentVariableValueRow } from '../queries/variables.query.types';
import type {
  EffectiveVariableQueryRows,
  LoadEffectiveVariablesInput,
  StoredEffectiveVariable,
} from './effective-variables.service.types';
import {
  appendDirectVariableScope,
  appendVariableSetScope,
  collectBoundVariableSetIds,
  compareEffectiveVariables,
  createVariableSetNamesById,
} from './effective-variables-resolution.helpers';

export { collectBoundVariableSetIds } from './effective-variables-resolution.helpers';

export function resolveStoredEffectiveVariables(
  input: LoadEffectiveVariablesInput,
  rows: EffectiveVariableQueryRows,
): StoredEffectiveVariable[] {
  const variableSetNamesById: Map<string, string> = createVariableSetNamesById(rows.variableSetNames);
  const effectiveVariables: Map<string, StoredEffectiveVariable> = new Map<string, StoredEffectiveVariable>();
  if (input.targetType === 'resource') {
    return resolveResourceStoredEffectiveVariables(input, rows, variableSetNamesById);
  }

  const environmentSetIds: string[] = collectBoundVariableSetIds(rows.variableSetBindings, null, true);

  appendVariableSetScope(
    effectiveVariables,
    rows.variableSetEntries,
    environmentSetIds,
    'environment',
    null,
    null,
    variableSetNamesById,
  );
  appendDirectVariableScope(effectiveVariables, rows.variableValues, null, null, null, input.targetType === 'service');
  appendServiceScopeOverrides(input, rows, effectiveVariables, variableSetNamesById);

  return [...effectiveVariables.values()].sort(compareEffectiveVariables);
}

function resolveResourceStoredEffectiveVariables(
  input: LoadEffectiveVariablesInput,
  rows: EffectiveVariableQueryRows,
  variableSetNamesById: ReadonlyMap<string, string>,
): StoredEffectiveVariable[] {
  const effectiveVariables: Map<string, StoredEffectiveVariable> = new Map<string, StoredEffectiveVariable>();
  const resourceName: string | null = input.targetResourceName;
  if (resourceName === null) {
    return [];
  }

  appendVariableSetScope(
    effectiveVariables,
    rows.variableSetEntries,
    collectBoundVariableSetIds(rows.variableSetBindings, null, false, resourceName),
    'resource',
    resourceName,
    null,
    variableSetNamesById,
  );
  appendDirectVariableScope(effectiveVariables, rows.variableValues, null, null, resourceName, false);

  return [...effectiveVariables.values()].sort(compareEffectiveVariables);
}

function appendServiceScopeOverrides(
  input: LoadEffectiveVariablesInput,
  rows: EffectiveVariableQueryRows,
  effectiveVariables: Map<string, StoredEffectiveVariable>,
  variableSetNamesById: ReadonlyMap<string, string>,
): void {
  const serviceTarget: { serviceId: string; serviceName: string | null } | null = readServiceTarget(input);
  if (serviceTarget === null) {
    return;
  }
  const serviceSetIds: string[] = collectBoundVariableSetIds(rows.variableSetBindings, serviceTarget.serviceId, false);

  appendVariableSetScope(
    effectiveVariables,
    rows.variableSetEntries,
    serviceSetIds,
    'service',
    null,
    serviceTarget.serviceName,
    variableSetNamesById,
  );
  appendServiceDirectVariableScope(effectiveVariables, rows.variableValues, serviceTarget);
}

function readServiceTarget(
  input: LoadEffectiveVariablesInput,
): { serviceId: string; serviceName: string | null } | null {
  if (input.targetType !== 'service' || input.targetServiceId === null) {
    return null;
  }

  return {
    serviceId: input.targetServiceId,
    serviceName: input.targetServiceName,
  };
}

function appendServiceDirectVariableScope(
  effectiveVariables: Map<string, StoredEffectiveVariable>,
  variableValues: EnvironmentVariableValueRow[],
  serviceTarget: { serviceId: string; serviceName: string | null },
): void {
  appendDirectVariableScope(
    effectiveVariables,
    variableValues,
    serviceTarget.serviceId,
    serviceTarget.serviceName,
    null,
    false,
  );
}
