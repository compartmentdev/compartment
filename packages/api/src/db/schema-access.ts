import { pgTable, text, timestamp, type PgTableExtraConfig, unique } from 'drizzle-orm/pg-core';
import { organizations, principals } from './schema-core';
import type * as AccessSchemaTypes from './schema-access.types';

export const organizationMemberships: AccessSchemaTypes.OrganizationMembershipsTable = pgTable(
  'organization_memberships',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references((): typeof organizations.id => organizations.id, { onDelete: 'cascade' }),
    principalId: text('principal_id')
      .notNull()
      .references((): typeof principals.id => principals.id, { onDelete: 'cascade' }),
    blockedAt: timestamp('blocked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: AccessSchemaTypes.OrganizationMembershipsExtraConfigColumns): PgTableExtraConfig => ({
    organizationPrincipalUnique: unique('organization_memberships_organization_principal_unique').on(
      table.organizationId,
      table.principalId,
    ),
  }),
);

export const accessRoles: AccessSchemaTypes.AccessRolesTable = pgTable(
  'access_roles',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references((): typeof organizations.id => organizations.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: AccessSchemaTypes.AccessRolesExtraConfigColumns): PgTableExtraConfig => ({
    organizationNameUnique: unique('access_roles_organization_name_unique').on(table.organizationId, table.name),
  }),
);

export const accessRolePermissions: AccessSchemaTypes.AccessRolePermissionsTable = pgTable(
  'access_role_permissions',
  {
    id: text('id').primaryKey(),
    permissionKey: text('permission_key').notNull(),
    roleId: text('role_id')
      .notNull()
      .references((): typeof accessRoles.id => accessRoles.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: AccessSchemaTypes.AccessRolePermissionsExtraConfigColumns): PgTableExtraConfig => ({
    rolePermissionUnique: unique('access_role_permissions_role_permission_unique').on(
      table.roleId,
      table.permissionKey,
    ),
  }),
);

export const accessGroups: AccessSchemaTypes.AccessGroupsTable = pgTable(
  'access_groups',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    organizationId: text('organization_id')
      .notNull()
      .references((): typeof organizations.id => organizations.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: AccessSchemaTypes.AccessGroupsExtraConfigColumns): PgTableExtraConfig => ({
    organizationNameUnique: unique('access_groups_organization_name_unique').on(table.organizationId, table.name),
  }),
);

export const accessGroupMemberships: AccessSchemaTypes.AccessGroupMembershipsTable = pgTable(
  'access_group_memberships',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references((): typeof accessGroups.id => accessGroups.id, { onDelete: 'cascade' }),
    principalId: text('principal_id')
      .notNull()
      .references((): typeof principals.id => principals.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: AccessSchemaTypes.AccessGroupMembershipsExtraConfigColumns): PgTableExtraConfig => ({
    groupPrincipalUnique: unique('access_group_memberships_group_principal_unique').on(
      table.groupId,
      table.principalId,
    ),
  }),
);

export const accessAssignments: AccessSchemaTypes.AccessAssignmentsTable = pgTable(
  'access_assignments',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references((): typeof organizations.id => organizations.id, { onDelete: 'cascade' }),
    roleId: text('role_id')
      .notNull()
      .references((): typeof accessRoles.id => accessRoles.id, { onDelete: 'cascade' }),
    scopeId: text('scope_id').notNull(),
    scopeType: text('scope_type').notNull(),
    subjectId: text('subject_id').notNull(),
    subjectType: text('subject_type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: AccessSchemaTypes.AccessAssignmentsExtraConfigColumns): PgTableExtraConfig => ({
    subjectRoleScopeUnique: unique('access_assignments_subject_role_scope_unique').on(
      table.subjectType,
      table.subjectId,
      table.roleId,
      table.scopeType,
      table.scopeId,
    ),
  }),
);
