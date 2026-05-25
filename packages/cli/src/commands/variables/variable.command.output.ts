import type {
  ImportVariablesResponse,
  VariableDetail,
  VariableListItem,
  VariableListResponse,
  VariableResponse,
} from '@compartment/contracts';
import { buildVariableTargetLabel } from './variable.command.helpers';

const variableListHeaders: readonly [string, string, string, string] = ['KEY', 'CLASS', 'SOURCE', 'SCOPE'];

export function createVariableListMessage(response: VariableListResponse): string {
  const header: string = buildVariableHeader(
    response.project.name,
    response.environment.name,
    response.resourceName,
    response.serviceName,
  );
  if (response.variables.length === 0) {
    return `${header}\n\nNo variables found.`;
  }

  return `${header}\n\n${buildVariableTable(
    response.variables.map((variable: VariableListItem): readonly [string, string, string, string] => [
      variable.keyName,
      variable.sensitivity,
      formatVariableSource(variable),
      formatVariableScope(response.environment.name, response.resourceName, response.serviceName, variable),
    ]),
  )}`;
}

export function createVariableShowMessage(response: VariableResponse): string {
  const variable: VariableDetail = response.variable;
  return `${buildVariableHeader(response.project.name, response.environment.name, response.resourceName, response.serviceName)}

KEY: ${variable.keyName}
CLASS: ${variable.sensitivity}
VALUE: ${variable.valueHidden ? '<hidden>' : (variable.value ?? '')}
SOURCE: ${formatVariableSource(variable)}
SCOPE: ${formatVariableScope(response.environment.name, response.resourceName, response.serviceName, variable)}`;
}

export function createSetVariableMessage(response: VariableResponse): string {
  return `Set variable ${response.variable.keyName} for ${buildVariableTargetLabel(
    response.project.name,
    response.environment.name,
    response.resourceName,
    response.serviceName,
  )}.`;
}

export function createImportVariablesMessage(response: ImportVariablesResponse): string {
  const importedCount: number = response.importedKeyNames.length;

  return `Imported ${importedCount} variable${importedCount === 1 ? '' : 's'} into ${buildVariableTargetLabel(
    response.project.name,
    response.environment.name,
    response.resourceName,
    response.serviceName,
  )}.`;
}

export function createRemoveVariableMessage(keyName: string): string {
  return `Removed variable ${keyName}.`;
}

function buildVariableHeader(
  projectName: string,
  environmentName: string,
  resourceName: string | null,
  serviceName: string | null,
): string {
  return `Project: ${projectName}
Environment: ${environmentName}
Target: ${formatRequestedTarget(resourceName, serviceName)}`;
}

function formatRequestedTarget(resourceName: string | null, serviceName: string | null): string {
  if (resourceName !== null) {
    return `resource ${resourceName}`;
  }
  if (serviceName !== null) {
    return `service ${serviceName}`;
  }

  return 'environment';
}

function buildVariableTable(rows: readonly (readonly [string, string, string, string])[]): string {
  const widths: number[] = [
    Math.max(
      variableListHeaders[0].length,
      ...rows.map((row: readonly [string, string, string, string]): number => row[0].length),
    ),
    Math.max(
      variableListHeaders[1].length,
      ...rows.map((row: readonly [string, string, string, string]): number => row[1].length),
    ),
    Math.max(
      variableListHeaders[2].length,
      ...rows.map((row: readonly [string, string, string, string]): number => row[2].length),
    ),
    Math.max(
      variableListHeaders[3].length,
      ...rows.map((row: readonly [string, string, string, string]): number => row[3].length),
    ),
  ];
  const renderedRows: string[] = [variableListHeaders, ...rows].map(
    (row: readonly [string, string, string, string]): string =>
      row.map((value: string, index: number): string => value.padEnd(widths[index] ?? 0)).join('  '),
  );

  return renderedRows.join('\n');
}

function formatVariableSource(variable: VariableListItem | VariableDetail): string {
  if (variable.sourceType === 'set') {
    return `group:${variable.sourceVariableSetName ?? 'unknown'}`;
  }
  if (variable.sourceType === 'resource_output') {
    return `resource:${variable.sourceResourceOutput ?? 'unknown'}`;
  }

  return variable.sourceType;
}

function formatVariableScope(
  environmentName: string,
  requestedResourceName: string | null,
  requestedServiceName: string | null,
  variable: VariableListItem | VariableDetail,
): string {
  if (variable.scopeType === 'environment') {
    return `${environmentName}/*`;
  }
  if (variable.scopeType === 'resource') {
    return `${environmentName}/resource/${variable.scopeResourceName ?? requestedResourceName ?? 'unknown'}`;
  }

  return `${environmentName}/${variable.scopeServiceName ?? requestedServiceName ?? 'unknown'}`;
}
