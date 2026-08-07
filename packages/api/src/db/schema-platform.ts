import { integer, pgTable, text, timestamp, type PgTableExtraConfig, unique } from 'drizzle-orm/pg-core';
import { organizations, principals } from './schema-core';
import type * as CoreSchemaTypes from './schema-core.types';
import type * as PlatformSchemaTypes from './schema-platform.types';

export const systemDomainSetupState: CoreSchemaTypes.SystemDomainSetupStateTable = pgTable(
  'system_domain_setup_state',
  {
    id: text('id').primaryKey(),
    setupVersion: integer('setup_version').default(0).notNull(),
    pendingStatus: text('pending_status'),
    pendingOperationId: text('pending_operation_id'),
    pendingDomainKind: text('pending_domain_kind'),
    pendingIssuerRefJson: text('pending_issuer_ref_json'),
    pendingTlsMode: text('pending_tls_mode'),
    pendingPublicScheme: text('pending_public_scheme'),
    pendingBaseDomain: text('pending_base_domain'),
    pendingRequiredDnsRecordsJson: text('pending_required_dns_records_json'),
    pendingFailureCode: text('pending_failure_code'),
    pendingFailureMessage: text('pending_failure_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
);

export const systemDomainIdempotencyKeys: CoreSchemaTypes.SystemDomainIdempotencyKeysTable = pgTable(
  'system_domain_idempotency_keys',
  {
    id: text('id').primaryKey(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    requestHash: text('request_hash').notNull(),
    responseJson: text('response_json').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
);

export const operations: CoreSchemaTypes.OperationsTable = pgTable('operations', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').references((): typeof organizations.id => organizations.id, {
    onDelete: 'cascade',
  }),
  type: text('type').notNull(),
  status: text('status').notNull(),
  actorPrincipalId: text('actor_principal_id').references((): typeof principals.id => principals.id),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  summary: text('summary').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const projects: PlatformSchemaTypes.ProjectsTable = pgTable(
  'projects',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references((): typeof organizations.id => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: PlatformSchemaTypes.ProjectsExtraConfigColumns): PgTableExtraConfig => ({
    organizationNameUnique: unique('projects_organization_id_name_unique').on(table.organizationId, table.name),
  }),
);

export const projectServices: PlatformSchemaTypes.ProjectServicesTable = pgTable(
  'project_services',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references((): typeof projects.id => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    path: text('path').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: PlatformSchemaTypes.ProjectServicesExtraConfigColumns): PgTableExtraConfig => ({
    projectNameUnique: unique('project_services_project_id_name_unique').on(table.projectId, table.name),
  }),
);

export const environments: PlatformSchemaTypes.EnvironmentsTable = pgTable(
  'environments',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references((): typeof projects.id => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: PlatformSchemaTypes.EnvironmentsExtraConfigColumns): PgTableExtraConfig => ({
    projectNameUnique: unique('environments_project_id_name_unique').on(table.projectId, table.name),
  }),
);
