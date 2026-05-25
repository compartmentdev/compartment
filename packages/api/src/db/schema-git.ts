import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  type PgTableExtraConfig,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  sourceBindingsActiveProjectUniqueConstraintName,
  sourceResolutionTaskMaxAttempts,
  sourcesActiveRepoUniqueConstraintName,
} from '../git-source.constants';
import { organizations, principals } from './schema-core';
import { deployments } from './schema-deploy';
import { gitProviderRegistrations } from './schema-git-provider';
import { projects } from './schema-platform';
import type * as GitSchemaTypes from './schema-git.types';
import type { DefaultTimestampBuilder, OptionalTimestampBuilder, RequiredTextBuilder } from './schema.shared.types';

interface DisconnectableOwnershipColumnBuilders {
  disconnectedAt: OptionalTimestampBuilder<'disconnected_at'>;
  createdByPrincipalId: RequiredTextBuilder<'created_by_principal_id'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

function buildDisconnectableOwnershipColumns(): DisconnectableOwnershipColumnBuilders {
  return {
    disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),
    createdByPrincipalId: text('created_by_principal_id')
      .notNull()
      .references((): typeof principals.id => principals.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  };
}

export const sources: GitSchemaTypes.SourcesTable = pgTable(
  'sources',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references((): typeof organizations.id => organizations.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['git'] }).notNull(),
    providerHost: text('provider_host').notNull(),
    providerRegistrationId: text('provider_registration_id')
      .notNull()
      .references((): typeof gitProviderRegistrations.id => gitProviderRegistrations.id, { onDelete: 'restrict' }),
    providerInstallationId: text('provider_installation_id').notNull(),
    repositoryExternalId: text('repository_external_id').notNull(),
    repositoryOwner: text('repository_owner').notNull(),
    repositoryName: text('repository_name').notNull(),
    repositoryCloneUrl: text('repository_clone_url').notNull(),
    displayName: text('display_name').notNull(),
    status: text('status', { enum: ['active', 'disabled', 'disconnected'] }).notNull(),
    defaultBranchName: text('default_branch_name').notNull(),
    syncBranchName: text('sync_branch_name').notNull(),
    autoAdoptNewApps: boolean('auto_adopt_new_apps').default(true).notNull(),
    defaultEnvironmentName: text('default_environment_name').notNull(),
    defaultAutoDeployEnabled: boolean('default_auto_deploy_enabled').default(false).notNull(),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    automationPrincipalId: text('automation_principal_id').references((): typeof principals.id => principals.id, {
      onDelete: 'set null',
    }),
    ...buildDisconnectableOwnershipColumns(),
  },
  (table: GitSchemaTypes.SourcesExtraConfigColumns): PgTableExtraConfig => ({
    activeRepoUnique: uniqueIndex(sourcesActiveRepoUniqueConstraintName)
      .on(table.organizationId, table.providerHost, table.repositoryExternalId)
      .where(sql`${table.status} = 'active'`),
    disconnectedRepoUnique: uniqueIndex('sources_disconnected_repo_unique')
      .on(table.organizationId, table.providerHost, table.repositoryExternalId)
      .where(sql`${table.status} = 'disconnected'`),
    disabledRepoUnique: uniqueIndex('sources_disabled_repo_unique')
      .on(table.organizationId, table.providerHost, table.repositoryExternalId)
      .where(sql`${table.status} = 'disabled'`),
  }),
);

export const sourceBindings: GitSchemaTypes.SourceBindingsTable = pgTable(
  'source_bindings',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references((): typeof sources.id => sources.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references((): typeof projects.id => projects.id, { onDelete: 'restrict' }),
    projectName: text('project_name').notNull(),
    descriptorPath: text('descriptor_path').notNull(),
    descriptorDirectory: text('descriptor_directory').notNull(),
    watchPathsJson: text('watch_paths_json').default('[]').notNull(),
    status: text('status', { enum: ['active', 'disconnected'] }).notNull(),
    autoDeployEnabled: boolean('auto_deploy_enabled').default(false).notNull(),
    ...buildDisconnectableOwnershipColumns(),
  },
  (table: GitSchemaTypes.SourceBindingsExtraConfigColumns): PgTableExtraConfig => ({
    activeProjectReferenceCheck: check(
      'source_bindings_active_project_reference_check',
      sql`${table.status} <> 'active' OR ${table.projectId} IS NOT NULL`,
    ),
    activeDescriptorUnique: uniqueIndex('source_bindings_active_descriptor_unique')
      .on(table.sourceId, table.descriptorPath)
      .where(sql`${table.status} = 'active'`),
    activeProjectNameUnique: uniqueIndex('source_bindings_active_project_name_unique')
      .on(table.sourceId, table.projectName)
      .where(sql`${table.status} = 'active'`),
    activeProjectUnique: uniqueIndex(sourceBindingsActiveProjectUniqueConstraintName)
      .on(table.projectId)
      .where(sql`${table.status} = 'active'`),
  }),
);

export const sourceExcludedDescriptors: GitSchemaTypes.SourceExcludedDescriptorsTable = pgTable(
  'source_excluded_descriptors',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references((): typeof sources.id => sources.id, { onDelete: 'cascade' }),
    descriptorPath: text('descriptor_path').notNull(),
    createdByPrincipalId: text('created_by_principal_id')
      .notNull()
      .references((): typeof principals.id => principals.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: GitSchemaTypes.SourceExcludedDescriptorsExtraConfigColumns): PgTableExtraConfig => ({
    sourceDescriptorUnique: uniqueIndex('source_excluded_descriptors_source_descriptor_unique').on(
      table.sourceId,
      table.descriptorPath,
    ),
  }),
);

export const sourceEvents: GitSchemaTypes.SourceEventsTable = pgTable(
  'source_events',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references((): typeof sources.id => sources.id, { onDelete: 'cascade' }),
    providerDeliveryId: text('provider_delivery_id').notNull(),
    eventType: text('event_type', { enum: ['push', 'source_sync'] }).notNull(),
    branchName: text('branch_name'),
    commitSha: text('commit_sha'),
    changedFilesJson: text('changed_files_json').default('[]').notNull(),
    changedFilesComplete: boolean('changed_files_complete').default(true).notNull(),
    payloadJson: text('payload_json').notNull(),
    status: text('status', { enum: ['received', 'tasks_created', 'completed'] }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table: GitSchemaTypes.SourceEventsExtraConfigColumns): PgTableExtraConfig => ({
    sourceDeliveryUnique: uniqueIndex('source_events_source_delivery_unique').on(
      table.sourceId,
      table.providerDeliveryId,
    ),
  }),
);

export const sourceResolutionTasks: GitSchemaTypes.SourceResolutionTasksTable = pgTable(
  'source_resolution_tasks',
  {
    id: text('id').primaryKey(),
    sourceEventId: text('source_event_id')
      .notNull()
      .references((): typeof sourceEvents.id => sourceEvents.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references((): typeof sources.id => sources.id, { onDelete: 'cascade' }),
    sourceBindingId: text('source_binding_id')
      .notNull()
      .references((): typeof sourceBindings.id => sourceBindings.id, { onDelete: 'cascade' }),
    commitSha: text('commit_sha').notNull(),
    branchName: text('branch_name').notNull(),
    targetEnvironmentName: text('target_environment_name').notNull(),
    status: text('status', { enum: ['pending', 'claimed', 'completed', 'failed', 'canceled'] }).notNull(),
    claimantId: text('claimant_id'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    attemptCount: integer('attempt_count').default(0).notNull(),
    maxAttempts: integer('max_attempts').default(sourceResolutionTaskMaxAttempts).notNull(),
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table: GitSchemaTypes.SourceResolutionTasksExtraConfigColumns): PgTableExtraConfig => ({
    bindingCommitEnvironmentUnique: uniqueIndex('source_resolution_tasks_binding_commit_environment_unique').on(
      table.sourceBindingId,
      table.commitSha,
      table.targetEnvironmentName,
    ),
    claimOrderIndex: index('source_resolution_tasks_status_created_id_idx').on(table.status, table.createdAt, table.id),
  }),
);

export const sourceResolutionTaskDeployments: GitSchemaTypes.SourceResolutionTaskDeploymentsTable = pgTable(
  'source_resolution_task_deployments',
  {
    id: text('id').primaryKey(),
    sourceResolutionTaskId: text('source_resolution_task_id')
      .notNull()
      .references((): typeof sourceResolutionTasks.id => sourceResolutionTasks.id, { onDelete: 'cascade' }),
    deploymentId: text('deployment_id')
      .notNull()
      .references((): typeof deployments.id => deployments.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: GitSchemaTypes.SourceResolutionTaskDeploymentsExtraConfigColumns): PgTableExtraConfig => ({
    taskDeploymentUnique: uniqueIndex('source_resolution_task_deployments_task_deployment_unique').on(
      table.sourceResolutionTaskId,
      table.deploymentId,
    ),
  }),
);

export const sourceBindingBranchMappings: GitSchemaTypes.SourceBindingBranchMappingsTable = pgTable(
  'source_binding_branch_mappings',
  {
    id: text('id').primaryKey(),
    sourceBindingId: text('source_binding_id')
      .notNull()
      .references((): typeof sourceBindings.id => sourceBindings.id, { onDelete: 'cascade' }),
    branchName: text('branch_name').notNull(),
    environmentName: text('environment_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: GitSchemaTypes.SourceBindingBranchMappingsExtraConfigColumns): PgTableExtraConfig => ({
    sourceBindingBranchUnique: uniqueIndex('source_binding_branch_mappings_branch_unique').on(
      table.sourceBindingId,
      table.branchName,
    ),
  }),
);
