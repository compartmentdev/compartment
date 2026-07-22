import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  type PgTableExtraConfig,
  unique,
} from 'drizzle-orm/pg-core';
import { principals } from './schema-core';
import { environments, operations } from './schema-platform';
import type * as DeploySchemaTypes from './schema-deploy.types';

export const projectResources: DeploySchemaTypes.ProjectResourcesTable = pgTable(
  'project_resources',
  {
    id: text('id').primaryKey(),
    environmentId: text('environment_id')
      .notNull()
      .references((): typeof environments.id => environments.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    image: text('image').notNull(),
    commandJson: text('command_json').notNull(),
    envJson: text('env_json').notNull(),
    operationsJson: text('operations_json').default('{"backup":null,"restore":null}').notNull(),
    operationConfigHash: text('operation_config_hash').default('').notNull(),
    outputsJson: text('outputs_json').default('{}').notNull(),
    portsJson: text('ports_json').notNull(),
    volumesJson: text('volumes_json').notNull(),
    readinessJson: text('readiness_json').notNull(),
    runtimeDefinitionHash: text('runtime_definition_hash').notNull(),
    expectedClaimsJson: text('expected_claims_json').default('[]').notNull(),
    deleteDataRequested: boolean('delete_data_requested').default(false).notNull(),
    status: text('status', { enum: ['deleting', 'running', 'starting', 'stopped'] }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: DeploySchemaTypes.ProjectResourcesExtraConfigColumns): PgTableExtraConfig => ({
    environmentNameUnique: unique('project_resources_environment_id_name_unique').on(table.environmentId, table.name),
  }),
);

export const resourceReconcileRuns: DeploySchemaTypes.ResourceReconcileRunsTable = pgTable(
  'resource_reconcile_runs',
  {
    id: text('id').primaryKey(),
    projectResourceId: text('project_resource_id')
      .notNull()
      .references((): typeof projectResources.id => projectResources.id, { onDelete: 'cascade' }),
    intentJson: text('intent_json').notNull(),
    expectedClaimsJson: text('expected_claims_json').notNull(),
    previousManifestJson: text('previous_manifest_json'),
    operationType: text('operation_type', { enum: ['bootstrap', 'reconcile'] }).notNull(),
    leaseId: text('lease_id'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    phase: text('phase', {
      enum: ['bootstrap-pending', 'reconcile-pending', 'running', 'succeeded', 'failed'],
    }).notNull(),
    failureMessage: text('failure_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: DeploySchemaTypes.ResourceReconcileRunsExtraConfigColumns): PgTableExtraConfig => ({
    activeOrderIndex: index('resource_reconcile_runs_active_order_idx')
      .on(table.createdAt, table.id)
      .where(sql`${table.phase} IN ('bootstrap-pending', 'reconcile-pending', 'running')`),
  }),
);

export const resourceBackups: DeploySchemaTypes.ResourceBackupsTable = pgTable(
  'resource_backups',
  {
    id: text('id').primaryKey(),
    projectResourceId: text('project_resource_id')
      .notNull()
      .references((): typeof projectResources.id => projectResources.id, { onDelete: 'cascade' }),
    operationId: text('operation_id')
      .notNull()
      .references((): typeof operations.id => operations.id, { onDelete: 'cascade' }),
    createdByPrincipalId: text('created_by_principal_id').references((): typeof principals.id => principals.id, {
      onDelete: 'set null',
    }),
    purpose: text('purpose', { enum: ['manual', 'pre_restore', 'scheduled'] }).notNull(),
    status: text('status', { enum: ['running', 'succeeded', 'failed', 'deleted'] }).notNull(),
    artifactLocation: text('artifact_location'),
    checksum: text('checksum'),
    sizeBytes: integer('size_bytes'),
    manifestJson: text('manifest_json'),
    resourceDefinitionJson: text('resource_definition_json'),
    failureSummary: text('failure_summary'),
    retentionAttempts: integer('retention_attempts').default(0).notNull(),
    retentionDeletedAt: timestamp('retention_deleted_at', { withTimezone: true }),
    retentionFailureSummary: text('retention_failure_summary'),
    retentionNextAttemptAt: timestamp('retention_next_attempt_at', { withTimezone: true }),
    retentionReason: text('retention_reason'),
    stdoutSummary: text('stdout_summary'),
    stderrSummary: text('stderr_summary'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table: DeploySchemaTypes.ResourceBackupsExtraConfigColumns): PgTableExtraConfig => ({
    resourceCreatedAtIndex: index('resource_backups_resource_created_at_idx').on(
      table.projectResourceId,
      table.createdAt,
    ),
  }),
);
