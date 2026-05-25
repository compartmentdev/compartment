import type { EnvironmentVariableValueRow } from '../queries/variables.query.types';
import { loadEffectiveVariables } from './effective-variables.service';
import type { EffectiveVariable } from './effective-variables.service.types';

interface DirectResourceEffectiveVariableInput {
  keyName: string;
  resourceName: string;
  row: EnvironmentVariableValueRow;
  value: string;
}

export async function loadResourceEffectiveVariables(
  environmentId: string,
  organizationId: string,
  resourceName: string,
): Promise<EffectiveVariable[]> {
  return await loadEffectiveVariables({
    environmentId,
    environmentName: '',
    organizationId,
    projectName: '',
    targetResourceName: resourceName,
    targetServiceId: null,
    targetServiceName: null,
    targetType: 'resource',
  });
}

export function buildDirectResourceEffectiveVariable(input: DirectResourceEffectiveVariableInput): EffectiveVariable {
  return {
    keyName: input.keyName,
    scopeResourceName: input.resourceName,
    scopeServiceName: null,
    scopeType: 'resource',
    sensitivity: input.row.sensitivity,
    sourceResourceOutput: null,
    sourceType: 'direct',
    sourceVariableSetName: null,
    value: input.value,
  };
}
