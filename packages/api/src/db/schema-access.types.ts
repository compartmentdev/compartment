import type {
  DefaultTimestampBuilder,
  OptionalTimestampBuilder,
  OptionalTextBuilder,
  PgExtraConfigColumnsOf,
  PgTableOf,
  PrimaryTextBuilder,
  RequiredTextBuilder,
} from './schema.shared.types';

interface OrganizationMembershipsColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  organizationId: RequiredTextBuilder<'organization_id'>;
  principalId: RequiredTextBuilder<'principal_id'>;
  blockedAt: OptionalTimestampBuilder<'blocked_at'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
}

interface AccessRolesColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  organizationId: RequiredTextBuilder<'organization_id'>;
  kind: RequiredTextBuilder<'kind'>;
  name: RequiredTextBuilder<'name'>;
  description: OptionalTextBuilder<'description'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

interface AccessRolePermissionsColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  permissionKey: RequiredTextBuilder<'permission_key'>;
  roleId: RequiredTextBuilder<'role_id'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
}

interface AccessGroupsColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  name: RequiredTextBuilder<'name'>;
  description: OptionalTextBuilder<'description'>;
  organizationId: RequiredTextBuilder<'organization_id'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

interface AccessGroupMembershipsColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  groupId: RequiredTextBuilder<'group_id'>;
  principalId: RequiredTextBuilder<'principal_id'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
}

interface AccessAssignmentsColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  organizationId: RequiredTextBuilder<'organization_id'>;
  roleId: RequiredTextBuilder<'role_id'>;
  scopeId: RequiredTextBuilder<'scope_id'>;
  scopeType: RequiredTextBuilder<'scope_type'>;
  subjectId: RequiredTextBuilder<'subject_id'>;
  subjectType: RequiredTextBuilder<'subject_type'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
}

export type OrganizationMembershipsTable = PgTableOf<'organization_memberships', OrganizationMembershipsColumnBuilders>;
export type OrganizationMembershipsExtraConfigColumns = PgExtraConfigColumnsOf<
  'organization_memberships',
  OrganizationMembershipsColumnBuilders
>;
export type AccessRolesTable = PgTableOf<'access_roles', AccessRolesColumnBuilders>;
export type AccessRolesExtraConfigColumns = PgExtraConfigColumnsOf<'access_roles', AccessRolesColumnBuilders>;
export type AccessRolePermissionsTable = PgTableOf<'access_role_permissions', AccessRolePermissionsColumnBuilders>;
export type AccessRolePermissionsExtraConfigColumns = PgExtraConfigColumnsOf<
  'access_role_permissions',
  AccessRolePermissionsColumnBuilders
>;
export type AccessGroupsTable = PgTableOf<'access_groups', AccessGroupsColumnBuilders>;
export type AccessGroupsExtraConfigColumns = PgExtraConfigColumnsOf<'access_groups', AccessGroupsColumnBuilders>;
export type AccessGroupMembershipsTable = PgTableOf<'access_group_memberships', AccessGroupMembershipsColumnBuilders>;
export type AccessGroupMembershipsExtraConfigColumns = PgExtraConfigColumnsOf<
  'access_group_memberships',
  AccessGroupMembershipsColumnBuilders
>;
export type AccessAssignmentsTable = PgTableOf<'access_assignments', AccessAssignmentsColumnBuilders>;
export type AccessAssignmentsExtraConfigColumns = PgExtraConfigColumnsOf<
  'access_assignments',
  AccessAssignmentsColumnBuilders
>;
