import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, type PgTableExtraConfig, uniqueIndex } from 'drizzle-orm/pg-core';
import { sourceSyncTaskMaxAttempts } from '../git-source.constants';
import type * as GitSchemaTypes from './schema-git.types';
import { principals } from './schema-core';
import { sourceEvents, sources } from './schema-git';

export const sourceSyncTasks: GitSchemaTypes.SourceSyncTasksTable = pgTable(
  'source_sync_tasks',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references((): typeof sources.id => sources.id, { onDelete: 'cascade' }),
    requestedByPrincipalId: text('requested_by_principal_id')
      .notNull()
      .references((): typeof principals.id => principals.id, { onDelete: 'restrict' }),
    requestedBranchName: text('requested_branch_name').notNull(),
    adoptionMode: text('adoption_mode', { enum: ['bootstrap', 'incremental'] }).notNull(),
    requestedDescriptorPathsJson: text('requested_descriptor_paths_json').default('[]').notNull(),
    resolvedCommitSha: text('resolved_commit_sha'),
    triggerSourceEventId: text('trigger_source_event_id').references((): typeof sourceEvents.id => sourceEvents.id, {
      onDelete: 'set null',
    }),
    triggerCommitSha: text('trigger_commit_sha'),
    status: text('status', { enum: ['pending', 'claimed', 'completed', 'failed', 'canceled'] }).notNull(),
    claimedByWorkerId: text('claimed_by_worker_id'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    attemptCount: integer('attempt_count').default(0).notNull(),
    maxAttempts: integer('max_attempts').default(sourceSyncTaskMaxAttempts).notNull(),
    failureReason: text('failure_reason'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: GitSchemaTypes.SourceSyncTasksExtraConfigColumns): PgTableExtraConfig => ({
    claimOrderIndex: index('source_sync_tasks_status_created_id_idx').on(table.status, table.createdAt, table.id),
    liveSourceUnique: uniqueIndex('source_sync_tasks_live_source_unique')
      .on(table.sourceId)
      .where(sql`${table.status} IN ('pending', 'claimed')`),
  }),
);

export const sourceSyncTaskCandidates: GitSchemaTypes.SourceSyncTaskCandidatesTable = pgTable(
  'source_sync_task_candidates',
  {
    id: text('id').primaryKey(),
    sourceSyncTaskId: text('source_sync_task_id')
      .notNull()
      .references((): typeof sourceSyncTasks.id => sourceSyncTasks.id, { onDelete: 'cascade' }),
    descriptorPath: text('descriptor_path').notNull(),
    descriptorDirectory: text('descriptor_directory').notNull(),
    projectName: text('project_name'),
    derivedWatchPathsJson: text('derived_watch_paths_json').default('[]').notNull(),
    blockedReason: text('blocked_reason'),
    status: text('status', { enum: ['accepted', 'blocked'] }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: GitSchemaTypes.SourceSyncTaskCandidatesExtraConfigColumns): PgTableExtraConfig => ({
    taskDescriptorUnique: uniqueIndex('source_sync_task_candidates_task_descriptor_unique').on(
      table.sourceSyncTaskId,
      table.descriptorPath,
    ),
  }),
);
