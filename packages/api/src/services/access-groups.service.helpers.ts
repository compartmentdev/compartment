import type { AccessAssignmentSummaryRow, AccessGroupRow } from '../queries/rbac.query.types';
import type { AccessGroupResult } from './access-groups.service.types';
import { buildScopeLabelByScopeKey, toScopeKey } from './access-scope-labels.service.helpers';

interface GroupListAccumulator {
  assignedRoleNames: Set<string>;
  assignmentScopeLabels: Set<string>;
}

export interface GroupListSummary {
  assignedRoleNames: string[];
  assignmentScopeLabels: string[];
}

export function toAccessGroupResult(group: AccessGroupRow): AccessGroupResult {
  return {
    assignmentCount: group.assignmentCount,
    description: group.description,
    id: group.id,
    memberCount: group.memberCount,
    name: group.name,
  };
}

export async function buildGroupListSummaries(
  assignments: readonly AccessAssignmentSummaryRow[],
): Promise<ReadonlyMap<string, GroupListSummary>> {
  const scopeLabelsByKey: ReadonlyMap<string, string> = await buildScopeLabelByScopeKey(assignments);
  const accumulatorsByGroupId: Map<string, GroupListAccumulator> = new Map<string, GroupListAccumulator>();
  for (const assignment of assignments) {
    addGroupListAssignment(accumulatorsByGroupId, assignment, scopeLabelsByKey);
  }

  return toGroupListSummaries(accumulatorsByGroupId);
}

function addGroupListAssignment(
  accumulatorsByGroupId: Map<string, GroupListAccumulator>,
  assignment: AccessAssignmentSummaryRow,
  scopeLabelsByKey: ReadonlyMap<string, string>,
): void {
  if (assignment.subjectType !== 'group') {
    return;
  }

  const accumulator: GroupListAccumulator =
    accumulatorsByGroupId.get(assignment.groupId) ?? createGroupListAccumulator();
  accumulator.assignedRoleNames.add(assignment.roleName);
  const scopeLabel: string | undefined = readAssignmentScopeLabel(assignment, scopeLabelsByKey);
  if (scopeLabel !== undefined) {
    accumulator.assignmentScopeLabels.add(scopeLabel);
  }
  accumulatorsByGroupId.set(assignment.groupId, accumulator);
}

function createGroupListAccumulator(): GroupListAccumulator {
  return {
    assignedRoleNames: new Set<string>(),
    assignmentScopeLabels: new Set<string>(),
  };
}

function toGroupListSummaries(
  accumulatorsByGroupId: Map<string, GroupListAccumulator>,
): ReadonlyMap<string, GroupListSummary> {
  return new Map<string, GroupListSummary>(
    [...accumulatorsByGroupId.entries()].map(
      ([groupId, accumulator]: [string, GroupListAccumulator]): [string, GroupListSummary] => [
        groupId,
        {
          assignedRoleNames: [...accumulator.assignedRoleNames].sort((left: string, right: string): number =>
            left.localeCompare(right),
          ),
          assignmentScopeLabels: [...accumulator.assignmentScopeLabels].sort((left: string, right: string): number =>
            left.localeCompare(right),
          ),
        },
      ],
    ),
  );
}

function readAssignmentScopeLabel(
  assignment: AccessAssignmentSummaryRow,
  scopeLabelsByKey: ReadonlyMap<string, string>,
): string | undefined {
  if (assignment.scopeType === 'organization') {
    return 'Org-wide';
  }

  return scopeLabelsByKey.get(toScopeKey(assignment.scopeType, assignment.scopeId));
}
