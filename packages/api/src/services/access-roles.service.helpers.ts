import type { AccessAssignmentSummaryRow } from '../queries/rbac.query.types';

interface RoleUsageAccumulator {
  assignmentCount: number;
  groupIds: Set<string>;
  principalEmails: Set<string>;
}

export interface RoleUsageSummary {
  assignmentCount: number;
  groupCount: number;
  principalCount: number;
}

export function buildRoleUsageByRoleId(
  assignments: readonly AccessAssignmentSummaryRow[],
): ReadonlyMap<string, RoleUsageSummary> {
  const usageByRoleId: Map<string, RoleUsageAccumulator> = new Map<string, RoleUsageAccumulator>();
  for (const assignment of assignments) {
    addRoleUsageAssignment(usageByRoleId, assignment);
  }

  return toRoleUsageSummaryMap(usageByRoleId);
}

function addRoleUsageAssignment(
  usageByRoleId: Map<string, RoleUsageAccumulator>,
  assignment: AccessAssignmentSummaryRow,
): void {
  const usage: RoleUsageAccumulator = usageByRoleId.get(assignment.roleId) ?? createRoleUsageAccumulator();
  usage.assignmentCount += 1;
  if (assignment.subjectType === 'group') {
    usage.groupIds.add(assignment.groupId);
  } else {
    usage.principalEmails.add(assignment.principalEmail);
  }
  usageByRoleId.set(assignment.roleId, usage);
}

function toRoleUsageSummaryMap(
  usageByRoleId: Map<string, RoleUsageAccumulator>,
): ReadonlyMap<string, RoleUsageSummary> {
  return new Map<string, RoleUsageSummary>(
    [...usageByRoleId.entries()].map(([roleId, usage]: [string, RoleUsageAccumulator]): [string, RoleUsageSummary] => [
      roleId,
      {
        assignmentCount: usage.assignmentCount,
        groupCount: usage.groupIds.size,
        principalCount: usage.principalEmails.size,
      },
    ]),
  );
}

function createRoleUsageAccumulator(): RoleUsageAccumulator {
  return {
    assignmentCount: 0,
    groupIds: new Set<string>(),
    principalEmails: new Set<string>(),
  };
}
