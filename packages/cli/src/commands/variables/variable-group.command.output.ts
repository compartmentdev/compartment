import type {
  CaptureVariableGroupResponse,
  VariableGroupDetail,
  ImportVariableGroupResponse,
  VariableGroupBindingResponse,
  VariableGroupListResponse,
  VariableGroupResponse,
  VariableGroupSummary,
  VariableGroupUsage,
  VariableGroupUsagesResponse,
  VariableGroupVariable,
} from '@compartment/contracts';
import { buildVariableTargetLabel } from './variable.command.helpers';

const variableGroupHeaders: readonly [string, string] = ['KEY', 'CLASS'];
const variableGroupUsageHeader: string = 'USED BY';

export function createVariableGroupListMessage(response: VariableGroupListResponse): string {
  if (response.variableGroups.length === 0) {
    return 'No variable groups found.';
  }

  return response.variableGroups
    .map((variableGroup: VariableGroupSummary): string =>
      `${variableGroup.name}\t${variableGroup.variableCount}\t${variableGroup.description ?? ''}`.trimEnd(),
    )
    .join('\n');
}

export function createVariableGroupShowMessage(response: VariableGroupResponse): string {
  const variableGroup: VariableGroupDetail = response.variableGroup;
  const headerLines: string[] = [`Variable Group: ${variableGroup.name}`];

  if (variableGroup.description !== null) {
    headerLines.push(`Description: ${variableGroup.description}`);
  }

  if (variableGroup.variables.length === 0) {
    return `${headerLines.join('\n')}\n\nNo variables found.`;
  }

  return `${headerLines.join('\n')}\n\n${buildVariableGroupVariableTable(variableGroup.variables)}`;
}

export function createVariableGroupUsagesMessage(response: VariableGroupUsagesResponse): string {
  const header: string = `Variable Group: ${response.variableGroup.name}`;
  if (response.usages.length === 0) {
    return `${header}\n\nNo usages found.`;
  }

  return `${header}\n\n${variableGroupUsageHeader}\n${response.usages
    .map((usage: VariableGroupUsage): string => formatVariableGroupUsageTarget(usage))
    .join('\n')}`;
}

export function createCreateVariableGroupMessage(response: VariableGroupResponse): string {
  return `Created variable group ${response.variableGroup.name}.`;
}

export function createPutVariableGroupVariableMessage(response: VariableGroupResponse): string {
  return `Updated variable group ${response.variableGroup.name}.`;
}

export function createImportVariableGroupMessage(response: ImportVariableGroupResponse): string {
  const count: number = response.importedKeyNames.length;
  return `Imported ${count} variable${count === 1 ? '' : 's'} into variable group ${response.variableGroup.name}.`;
}

export function createCaptureVariableGroupMessage(response: CaptureVariableGroupResponse): string {
  const count: number = response.capturedKeyNames.length;
  const target: string = buildVariableTargetLabel(
    response.project.name,
    response.environment.name,
    response.resourceName,
    response.serviceName,
  );

  return `Captured ${count} variable${count === 1 ? '' : 's'} into variable group ${response.variableGroup.name} from ${target}.`;
}

export function createBindVariableGroupMessage(response: VariableGroupBindingResponse): string {
  return `Bound variable group ${response.variableGroupName} to ${buildVariableTargetLabel(
    response.project.name,
    response.environment.name,
    response.resourceName,
    response.serviceName,
  )}.`;
}

export function createUnbindVariableGroupMessage(response: VariableGroupBindingResponse): string {
  return `Unbound variable group ${response.variableGroupName} from ${buildVariableTargetLabel(
    response.project.name,
    response.environment.name,
    response.resourceName,
    response.serviceName,
  )}.`;
}

function formatVariableGroupUsageTarget(usage: VariableGroupUsage): string {
  if (usage.resourceName !== null) {
    return `${usage.projectName} / ${usage.environmentName} / resource ${usage.resourceName}`;
  }

  return `${usage.projectName} / ${usage.environmentName} / ${usage.serviceName ?? '*'}`;
}

function buildVariableGroupVariableTable(variables: readonly VariableGroupVariable[]): string {
  const rows: readonly (readonly [string, string])[] = variables.map(
    (variable: VariableGroupVariable): readonly [string, string] => [variable.keyName, variable.sensitivity],
  );
  const widths: number[] = [
    Math.max(variableGroupHeaders[0].length, ...rows.map((row: readonly [string, string]): number => row[0].length)),
    Math.max(variableGroupHeaders[1].length, ...rows.map((row: readonly [string, string]): number => row[1].length)),
  ];
  const renderedRows: string[] = [variableGroupHeaders, ...rows].map((row: readonly [string, string]): string =>
    row.map((value: string, index: number): string => value.padEnd(widths[index] ?? 0)).join('  '),
  );

  return renderedRows.join('\n');
}
