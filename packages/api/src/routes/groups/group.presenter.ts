import type {
  AccessGroupListRow,
  AccessGroupMemberListResponse,
  AccessGroupMemberSummary,
  AccessGroupResponse,
  AccessGroupSummary,
} from '@compartment/contracts';
import type {
  AccessGroupListRowResult,
  AccessGroupMemberResult,
  AccessGroupResult,
} from '../../services/access-groups.service.types';

export function buildAccessGroupListRows(groups: readonly AccessGroupListRowResult[]): AccessGroupListRow[] {
  return groups.map(
    (group: AccessGroupListRowResult): AccessGroupListRow => ({
      ...buildAccessGroupSummary(group),
      assignedRoleNames: group.assignedRoleNames,
      assignmentScopeLabels: group.assignmentScopeLabels,
    }),
  );
}

export function buildAccessGroupResponse(group: AccessGroupResult): AccessGroupResponse {
  return { group: buildAccessGroupSummary(group) };
}

export function buildAccessGroupMembersResponse(
  members: readonly AccessGroupMemberResult[],
): AccessGroupMemberListResponse {
  return {
    members: members.map(
      (member: AccessGroupMemberResult): AccessGroupMemberSummary => ({
        email: member.email,
        id: member.id,
        status: member.status,
      }),
    ),
  };
}

export function buildAccessGroupSummary(group: AccessGroupResult): AccessGroupSummary {
  return {
    assignmentCount: group.assignmentCount,
    description: group.description,
    id: group.id,
    memberCount: group.memberCount,
    name: group.name,
  };
}
