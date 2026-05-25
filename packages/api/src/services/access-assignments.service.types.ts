import type { AccessRoleKind, CreateAccessAssignmentRequest, PermissionKey } from '@compartment/contracts';
import type { AccessGroupResult } from './access-groups.service.types';
import type { OrganizationUserResult } from './organization-users.service.types';

export interface CreateOrganizationAccessAssignmentInput {
  actorPrincipalId: string;
  organizationId: string;
  request: CreateAccessAssignmentRequest;
}

export interface DeleteOrganizationAccessAssignmentInput {
  actorPrincipalId: string;
  assignmentId: string;
  organizationId: string;
}

export interface OrganizationAccessAssignmentScopeResult {
  scopeType: 'organization';
}

export interface ProjectAccessAssignmentScopeResult {
  projectName: string;
  scopeType: 'project';
}

export interface EnvironmentAccessAssignmentScopeResult {
  environmentName: string;
  projectName: string;
  scopeType: 'environment';
}

export type AccessAssignmentScopeResult =
  | OrganizationAccessAssignmentScopeResult
  | ProjectAccessAssignmentScopeResult
  | EnvironmentAccessAssignmentScopeResult;

export interface PrincipalAccessAssignmentSubjectResult {
  principalEmail: string;
  subjectType: 'principal';
}

export interface GroupAccessAssignmentSubjectResult {
  groupId: string;
  groupName: string;
  subjectType: 'group';
}

export type AccessAssignmentSubjectResult = PrincipalAccessAssignmentSubjectResult | GroupAccessAssignmentSubjectResult;

export interface AccessAssignmentResult {
  createdAt: string;
  id: string;
  roleId: string;
  roleKind: AccessRoleKind;
  roleName: string;
  scope: AccessAssignmentScopeResult;
  subject: AccessAssignmentSubjectResult;
}

export interface AccessAssignmentMutationResult {
  assignment: AccessAssignmentResult;
  created: boolean;
}

export interface UserAccessDetailResult {
  directAssignments: AccessAssignmentResult[];
  effectivePermissions: PermissionKey[];
  groups: AccessGroupResult[];
  user: OrganizationUserResult;
}
