import type { AccessRoleKind, AccessSummaryLabel, PermissionKey } from './access.contract';
import type { OrganizationUserSummary } from './users.contract';

export interface AccessRoleSummary {
  description: string | null;
  id: string;
  kind: AccessRoleKind;
  name: string;
  permissionKeys: PermissionKey[];
}

export interface AccessRoleListRow extends AccessRoleSummary {
  assignmentCount: number;
  groupCount: number;
  principalCount: number;
}

export interface AccessRoleResponse {
  role: AccessRoleSummary;
}

export interface AccessRoleListResponse {
  roles: AccessRoleListRow[];
}

export interface CreateAccessRoleRequest {
  description?: string | null | undefined;
  name: string;
  permissionKeys: PermissionKey[];
}

export interface UpdateAccessRoleRequest {
  description?: string | null | undefined;
  name?: string | undefined;
  permissionKeys?: PermissionKey[] | undefined;
}

export interface AccessGroupSummary {
  assignmentCount: number;
  description: string | null;
  id: string;
  memberCount: number;
  name: string;
}

export interface AccessGroupListRow extends AccessGroupSummary {
  assignedRoleNames: string[];
  assignmentScopeLabels: string[];
}

export interface AccessGroupResponse {
  group: AccessGroupSummary;
}

export interface AccessGroupListResponse {
  groups: AccessGroupListRow[];
}

export interface CreateAccessGroupRequest {
  description?: string | null | undefined;
  name: string;
}

export interface UpdateAccessGroupRequest {
  name: string;
  description?: string | null | undefined;
}

export interface AccessGroupMemberSummary {
  email: string;
  id: string;
  status: 'active' | 'invited';
}

export interface AccessGroupMemberListResponse {
  members: AccessGroupMemberSummary[];
}

export interface AddAccessGroupMemberRequest {
  email: string;
}

export interface OrganizationAssignmentScopeTarget {
  scopeType: 'organization';
}

export interface ProjectAssignmentScopeTarget {
  projectName: string;
  scopeType: 'project';
}

export interface EnvironmentAssignmentScopeTarget {
  environmentName: string;
  projectName: string;
  scopeType: 'environment';
}

export type AccessAssignmentScopeTarget =
  | OrganizationAssignmentScopeTarget
  | ProjectAssignmentScopeTarget
  | EnvironmentAssignmentScopeTarget;

export interface PrincipalAccessAssignmentSubject {
  principalEmail: string;
  subjectType: 'principal';
}

export interface GroupAccessAssignmentSubject {
  groupId: string;
  subjectType: 'group';
}

export type CreateAccessAssignmentSubject = PrincipalAccessAssignmentSubject | GroupAccessAssignmentSubject;

export interface PrincipalAccessAssignmentSubjectSummary {
  principalEmail: string;
  subjectType: 'principal';
}

export interface GroupAccessAssignmentSubjectSummary {
  groupId: string;
  groupName: string;
  subjectType: 'group';
}

export type AccessAssignmentSubjectSummary =
  | PrincipalAccessAssignmentSubjectSummary
  | GroupAccessAssignmentSubjectSummary;

export interface CreateAccessAssignmentRequest {
  roleId: string;
  scope: AccessAssignmentScopeTarget;
  subject: CreateAccessAssignmentSubject;
}

export interface AccessAssignmentSummary {
  createdAt: string;
  id: string;
  roleId: string;
  roleKind: AccessRoleKind;
  roleName: string;
  scope: AccessAssignmentScopeTarget;
  subject: AccessAssignmentSubjectSummary;
}

export interface AccessAssignmentResponse {
  assignment: AccessAssignmentSummary;
}

export interface AccessAssignmentListResponse {
  assignments: AccessAssignmentSummary[];
}

export interface AccessAssignmentScopeProjectOption {
  environmentNames: string[];
  projectName: string;
}

export interface AccessAssignmentScopeOptionsResponse {
  projects: AccessAssignmentScopeProjectOption[];
}

export interface OrganizationUserListRow extends OrganizationUserSummary {
  accessSummary: AccessSummaryLabel;
  directAccessScopeLabels: string[];
  groupNames: string[];
}

export interface UserAccessDetail {
  directAssignments: AccessAssignmentSummary[];
  effectivePermissions: PermissionKey[];
  groups: AccessGroupSummary[];
  user: OrganizationUserSummary;
}

export interface UserAccessDetailResponse {
  access: UserAccessDetail;
}
