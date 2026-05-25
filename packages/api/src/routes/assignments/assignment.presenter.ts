import type {
  AccessAssignmentListResponse,
  AccessAssignmentResponse,
  AccessAssignmentScopeTarget,
  AccessAssignmentScopeOptionsResponse,
  AccessAssignmentScopeProjectOption,
  AccessAssignmentSubjectSummary,
  AccessAssignmentSummary,
  AccessGroupSummary,
  UserAccessDetailResponse,
} from '@compartment/contracts';
import type { AccessAssignmentScopeProjectResult } from '../../services/access-assignment-scope-options.service.types';
import type { AccessGroupResult } from '../../services/access-groups.service.types';
import type {
  AccessAssignmentResult,
  AccessAssignmentScopeResult,
  AccessAssignmentSubjectResult,
  UserAccessDetailResult,
} from '../../services/access-assignments.service.types';
import { buildAccessGroupSummary } from '../groups/group.presenter';
import { buildOrganizationUserSummary } from '../users/user.presenter';

export function buildAccessAssignmentListResponse(
  assignments: readonly AccessAssignmentResult[],
): AccessAssignmentListResponse {
  return {
    assignments: assignments.map(buildAccessAssignmentSummary),
  };
}

export function buildAccessAssignmentResponse(assignment: AccessAssignmentResult): AccessAssignmentResponse {
  return { assignment: buildAccessAssignmentSummary(assignment) };
}

export function buildUserAccessDetailResponse(access: UserAccessDetailResult): UserAccessDetailResponse {
  return {
    access: {
      directAssignments: access.directAssignments.map(buildAccessAssignmentSummary),
      effectivePermissions: access.effectivePermissions,
      groups: access.groups.map((group: AccessGroupResult): AccessGroupSummary => buildAccessGroupSummary(group)),
      user: buildOrganizationUserSummary(access.user),
    },
  };
}

export function buildAccessAssignmentScopeOptionsResponse(
  projects: readonly AccessAssignmentScopeProjectResult[],
): AccessAssignmentScopeOptionsResponse {
  return {
    projects: projects.map(
      (project: AccessAssignmentScopeProjectResult): AccessAssignmentScopeProjectOption => ({
        environmentNames: [...project.environmentNames],
        projectName: project.projectName,
      }),
    ),
  };
}

function buildAccessAssignmentSummary(assignment: AccessAssignmentResult): AccessAssignmentSummary {
  return {
    createdAt: assignment.createdAt,
    id: assignment.id,
    roleId: assignment.roleId,
    roleKind: assignment.roleKind,
    roleName: assignment.roleName,
    scope: buildAccessAssignmentScopeTarget(assignment.scope),
    subject: buildAccessAssignmentSubjectSummary(assignment.subject),
  };
}

function buildAccessAssignmentScopeTarget(scope: AccessAssignmentScopeResult): AccessAssignmentScopeTarget {
  switch (scope.scopeType) {
    case 'organization':
      return { scopeType: 'organization' };
    case 'project':
      return {
        projectName: scope.projectName,
        scopeType: 'project',
      };
    case 'environment':
      return {
        environmentName: scope.environmentName,
        projectName: scope.projectName,
        scopeType: 'environment',
      };
  }
}

function buildAccessAssignmentSubjectSummary(subject: AccessAssignmentSubjectResult): AccessAssignmentSubjectSummary {
  switch (subject.subjectType) {
    case 'group':
      return {
        groupId: subject.groupId,
        groupName: subject.groupName,
        subjectType: 'group',
      };
    case 'principal':
      return {
        principalEmail: subject.principalEmail,
        subjectType: 'principal',
      };
  }
}
