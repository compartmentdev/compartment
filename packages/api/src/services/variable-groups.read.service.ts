import { listVariableGroupUsages, listVariableGroups } from '../queries/variable-groups.query';
import type { VariableGroupSummaryRow } from '../queries/variable-groups.query.types';
import {
  buildVariableGroupDetailResult,
  buildVariableGroupSummaryResult,
  loadVariableGroup,
} from './variable-groups.service.helpers';
import type {
  LoadedVariableGroup,
  VariableGroupListResult,
  VariableGroupReadInput,
  VariableGroupResponseResult,
  VariableGroupUsagesResult,
} from './variable-groups.service.types';

export async function listVariableGroupsForPrincipal(input: {
  organizationId: string;
}): Promise<VariableGroupListResult> {
  const variableGroups: VariableGroupSummaryRow[] = await listVariableGroups(input.organizationId);

  return {
    variableGroups: variableGroups.map(buildVariableGroupSummaryResult),
  };
}

export async function showVariableGroupForPrincipal(
  input: VariableGroupReadInput,
): Promise<VariableGroupResponseResult> {
  return {
    variableGroup: buildVariableGroupDetailResult(
      await loadVariableGroup(input.organizationId, input.variableGroupName),
    ),
  };
}

export async function listVariableGroupUsagesForPrincipal(
  input: VariableGroupReadInput,
): Promise<VariableGroupUsagesResult> {
  const variableGroup: LoadedVariableGroup = await loadVariableGroup(input.organizationId, input.variableGroupName);

  return {
    usages: await listVariableGroupUsages(input.organizationId, variableGroup.id),
    variableGroup: buildVariableGroupSummaryResult({
      createdAt: variableGroup.createdAt,
      description: variableGroup.description,
      name: variableGroup.name,
      updatedAt: variableGroup.updatedAt,
      variableCount: variableGroup.variables.length,
    }),
  };
}
