import { buildResourceOutputReference } from '@compartment/contracts';
import { listProjectResourcesByEnvironmentId } from '../queries/resources.query';
import type { ProjectResourceRow } from '../queries/resources.query.types';
import { listEnvironmentVariableValues, listProjectServiceNamesByProjectId } from '../queries/variables.query';
import { listEnvironmentResourceOutputVariableBindings } from '../queries/variables-resource-output.query';
import type {
  EnvironmentResourceOutputVariableBindingRow,
  EnvironmentVariableValueRow,
  ProjectServiceNameRow,
} from '../queries/variables.query.types';
import type { ListedVariable } from './effective-variables.service.types';
import { readStoredResourceOutputSensitivity } from './variables.resource-output.service';
import type { VariableTargetContext } from './variables.service.types';

interface EnvironmentVariableInventoryRows {
  bindings: EnvironmentResourceOutputVariableBindingRow[];
  resources: ProjectResourceRow[];
  services: ProjectServiceNameRow[];
  variableValues: EnvironmentVariableValueRow[];
}

export async function loadEnvironmentVariableInventory(target: VariableTargetContext): Promise<ListedVariable[]> {
  const rows: EnvironmentVariableInventoryRows = await loadEnvironmentVariableInventoryRows(target);
  const serviceNamesById: Map<string, string> = new Map<string, string>(
    rows.services.map((service: ProjectServiceNameRow): [string, string] => [service.id, service.name]),
  );
  const resourcesByName: Map<string, ProjectResourceRow> = new Map<string, ProjectResourceRow>(
    rows.resources.map((resource: ProjectResourceRow): [string, ProjectResourceRow] => [resource.name, resource]),
  );

  return [
    ...rows.variableValues.map(
      (variable: EnvironmentVariableValueRow): ListedVariable =>
        buildDirectInventoryVariable(variable, serviceNamesById),
    ),
    ...rows.bindings.map(
      (binding: EnvironmentResourceOutputVariableBindingRow): ListedVariable =>
        buildResourceOutputInventoryVariable(binding, resourcesByName),
    ),
  ].sort(compareListedVariables);
}

async function loadEnvironmentVariableInventoryRows(
  target: VariableTargetContext,
): Promise<EnvironmentVariableInventoryRows> {
  const [variableValues, services, bindings, resources]: [
    EnvironmentVariableValueRow[],
    ProjectServiceNameRow[],
    EnvironmentResourceOutputVariableBindingRow[],
    ProjectResourceRow[],
  ] = await Promise.all([
    listEnvironmentVariableValues(target.environment.id),
    listProjectServiceNamesByProjectId(target.project.id),
    listEnvironmentResourceOutputVariableBindings(target.environment.id),
    listProjectResourcesByEnvironmentId(target.environment.id),
  ]);

  return { bindings, resources, services, variableValues };
}

function buildDirectInventoryVariable(
  variable: EnvironmentVariableValueRow,
  serviceNamesById: ReadonlyMap<string, string>,
): ListedVariable {
  return {
    keyName: variable.keyName,
    scopeResourceName: variable.targetResourceName,
    scopeServiceName:
      variable.projectServiceId === null ? null : (serviceNamesById.get(variable.projectServiceId) ?? null),
    scopeType: readVariableValueScopeType(variable),
    sensitivity: variable.sensitivity,
    sourceResourceOutput: null,
    sourceType: 'direct',
    sourceVariableSetName: null,
  };
}

function buildResourceOutputInventoryVariable(
  binding: EnvironmentResourceOutputVariableBindingRow,
  resourcesByName: ReadonlyMap<string, ProjectResourceRow>,
): ListedVariable {
  const resource: ProjectResourceRow | undefined = resourcesByName.get(binding.resourceName);

  return {
    keyName: binding.keyName,
    scopeResourceName: null,
    scopeServiceName: binding.targetServiceName,
    scopeType: 'service',
    sensitivity:
      resource === undefined ? 'sensitive' : (readStoredResourceOutputSensitivity(resource, binding) ?? 'sensitive'),
    sourceResourceOutput: buildResourceOutputReference(binding),
    sourceType: 'resource_output',
    sourceVariableSetName: null,
  };
}

function compareListedVariables(left: ListedVariable, right: ListedVariable): number {
  const keyComparison: number = left.keyName.localeCompare(right.keyName);
  if (keyComparison !== 0) {
    return keyComparison;
  }

  const leftScopeRank: number = left.scopeType === 'environment' ? 0 : 1;
  const rightScopeRank: number = right.scopeType === 'environment' ? 0 : 1;
  if (leftScopeRank !== rightScopeRank) {
    return leftScopeRank - rightScopeRank;
  }

  return (left.scopeServiceName ?? left.scopeResourceName ?? '').localeCompare(
    right.scopeServiceName ?? right.scopeResourceName ?? '',
  );
}

function readVariableValueScopeType(variable: EnvironmentVariableValueRow): 'environment' | 'resource' | 'service' {
  if (variable.targetResourceName !== null) {
    return 'resource';
  }

  return variable.projectServiceId === null ? 'environment' : 'service';
}
