import type { AccessAssignmentScopeType, AccessRoleKind, PermissionKey } from '@compartment/contracts';
import type { SelectedFields } from 'drizzle-orm/pg-core/query-builders/select.types';
import type { ApiDatabaseTransaction } from '../db/client.types';
import type { accessAssignments, accessGroups, accessRoles, principals } from '../db/schema';

export type AccessAssignmentScopeTypeValue = AccessAssignmentScopeType;
export type AccessAssignmentSubjectTypeValue = 'group' | 'principal';
export type AccessRoleKindValue = AccessRoleKind;

export interface AccessRoleRow {
  createdAt: Date;
  description: string | null;
  id: string;
  kind: AccessRoleKind;
  name: string;
  organizationId: string;
  permissionKeys: PermissionKey[];
  updatedAt: Date;
}

export interface AccessGroupRow {
  assignmentCount: number;
  createdAt: Date;
  description: string | null;
  id: string;
  memberCount: number;
  name: string;
  organizationId: string;
  updatedAt: Date;
}

export interface AccessGroupMemberRow {
  email: string;
  id: string;
  status: 'active' | 'invited';
}

export interface AccessGroupAggregateRow {
  assignmentCount: number;
  createdAt: Date;
  description: string | null;
  id: string;
  memberCount: number;
  name: string;
  organizationId: string;
  updatedAt: Date;
}

export interface AccessGroupMemberQueryRow {
  blockedAt: Date | null;
  email: string;
  id: string;
  passwordHash: string | null;
}

export interface AccessAssignmentRow {
  createdAt: Date;
  id: string;
  organizationId: string;
  roleId: string;
  scopeId: string;
  scopeType: AccessAssignmentScopeTypeValue;
  subjectId: string;
  subjectType: AccessAssignmentSubjectTypeValue;
}

export interface GroupAccessAssignmentPermissionGrantRow {
  permissionKey: PermissionKey | null;
  roleId: string;
  scopeId: string;
  scopeType: AccessAssignmentScopeTypeValue;
}

export interface CreateAccessAssignmentResult {
  assignment: AccessAssignmentRow;
  created: boolean;
}

interface AccessAssignmentSummaryBaseRow {
  createdAt: Date;
  id: string;
  roleId: string;
  roleKind: AccessRoleKindValue;
  roleName: string;
  scopeId: string;
  scopeType: AccessAssignmentScopeTypeValue;
}

interface GroupAccessAssignmentSummaryRow extends AccessAssignmentSummaryBaseRow {
  groupId: string;
  groupName: string;
  principalEmail: null;
  subjectType: 'group';
}

interface PrincipalAccessAssignmentSummaryRow extends AccessAssignmentSummaryBaseRow {
  groupId: null;
  groupName: null;
  principalEmail: string;
  subjectType: 'principal';
}

export type AccessAssignmentSummaryRow = GroupAccessAssignmentSummaryRow | PrincipalAccessAssignmentSummaryRow;

export interface AccessAssignmentSummarySelection extends SelectedFields {
  createdAt: typeof accessAssignments.createdAt;
  groupId: typeof accessGroups.id;
  groupName: typeof accessGroups.name;
  id: typeof accessAssignments.id;
  principalEmail: typeof principals.email;
  roleId: typeof accessRoles.id;
  roleKind: typeof accessRoles.kind;
  roleName: typeof accessRoles.name;
  scopeId: typeof accessAssignments.scopeId;
  scopeType: typeof accessAssignments.scopeType;
  subjectType: typeof accessAssignments.subjectType;
}

export interface PrincipalPermissionGrantRow {
  permissionKey: PermissionKey;
  roleId: string;
  roleKind: AccessRoleKindValue;
  roleName: string;
  scopeId: string;
  scopeType: AccessAssignmentScopeTypeValue;
}

export interface PrincipalPermissionKeyRow {
  permissionKey: PermissionKey;
  principalId: string;
}

export interface PrincipalPermissionGrantQueryRow {
  permissionKey: PermissionKey;
  roleId: string;
  roleKind: AccessRoleKindValue;
  roleName: string;
  scopeId: string;
  scopeType: AccessAssignmentScopeTypeValue;
}

export interface PrincipalGrantedRoleNameRow {
  principalId: string;
  roleName: string;
}

export interface PrincipalGroupNameRow {
  groupName: string;
  principalId: string;
}

export interface PrincipalGroupCountRow {
  groupCount: number;
  principalId: string;
}

export interface PrincipalScopeRow {
  principalId: string;
  scopeId: string;
  scopeType: AccessAssignmentScopeTypeValue;
}

export interface AccessGroupPrincipalMembershipInput {
  groupId: string;
  organizationId: string;
  principalId: string;
}

export interface CreateOrganizationMembershipInput {
  id: string;
  organizationId: string;
  principalId: string;
}

export interface CreateAccessRoleInput {
  description: string | null;
  id: string;
  kind: AccessRoleKind;
  name: string;
  organizationId: string;
  permissionKeys: PermissionKey[];
  updatedAt: Date;
}

export interface UpdateAccessRoleInput {
  description: string | null;
  organizationId: string;
  permissionKeys: PermissionKey[];
  roleId: string;
  updatedAt: Date;
}

export interface CreateAccessGroupInput {
  description: string | null;
  id: string;
  name: string;
  organizationId: string;
  updatedAt: Date;
}

export interface CreateAccessGroupMembershipInput {
  groupId: string;
  id: string;
  principalId: string;
}

export interface CreateAccessAssignmentInput {
  id: string;
  organizationId: string;
  roleId: string;
  scopeId: string;
  scopeType: AccessAssignmentScopeTypeValue;
  subjectId: string;
  subjectType: AccessAssignmentSubjectTypeValue;
}

export interface ScopedAssignmentIdsInput {
  organizationId: string;
  principalId: string;
  scopeType: 'environment' | 'project';
}

export interface AllPrincipalPermissionGrantStateRow {
  permissionKey: PermissionKey;
  principalId: string;
  scopeId: string;
  scopeType: AccessAssignmentScopeTypeValue;
}

export interface AllPrincipalPermissionGrantStateQueryRow {
  permissionKey: PermissionKey;
  principalId: string;
  scopeId: string;
  scopeType: AccessAssignmentScopeTypeValue;
}

export type RbacTransaction = ApiDatabaseTransaction;
