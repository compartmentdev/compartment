import { index, integer, pgTable, text, timestamp, uniqueIndex, type PgTableExtraConfig } from 'drizzle-orm/pg-core';
import { deployments } from './schema-deploy';
import type * as KubeRuntimeSchemaTypes from './schema-kube-runtime.types';

export const deploymentKubeReferences: KubeRuntimeSchemaTypes.DeploymentKubeReferencesTable = pgTable(
  'deployment_kube_references',
  {
    id: text('id').primaryKey(),
    deploymentId: text('deployment_id')
      .notNull()
      .references((): typeof deployments.id => deployments.id, { onDelete: 'cascade' })
      .unique(),
    namespace: text('namespace').notNull(),
    deploymentName: text('deployment_name').notNull(),
    serviceName: text('service_name').notNull(),
    networkPolicyNamesJson: text('network_policy_names_json').notNull(),
    state: text('state', { enum: ['desired', 'pending', 'active'] }).notNull(),
    revision: integer('revision').default(0).notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }),
    transitionedAt: timestamp('transitioned_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: KubeRuntimeSchemaTypes.DeploymentKubeReferencesExtraConfigColumns): PgTableExtraConfig => ({
    stateUpdatedAtIndex: index('deployment_kube_references_state_updated_at_idx').on(table.state, table.updatedAt),
  }),
);

export const productJobRuns: KubeRuntimeSchemaTypes.ProductJobRunsTable = pgTable(
  'product_job_runs',
  {
    id: text('id').primaryKey(),
    jobClass: text('job_class', { enum: ['release', 'resource-operation'] }).notNull(),
    identityId: text('identity_id').notNull(),
    image: text('image').notNull(),
    commandJson: text('command_json').notNull(),
    envJson: text('env_json').notNull(),
    volumeMountsJson: text('volume_mounts_json').default('[]').notNull(),
    namespace: text('namespace').notNull(),
    timeoutMs: integer('timeout_ms').notNull(),
    status: text('status', { enum: ['queued', 'running', 'succeeded', 'failed', 'timed-out'] }).notNull(),
    exitCode: integer('exit_code'),
    jobName: text('job_name'),
    podName: text('pod_name'),
    logs: text('logs'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: KubeRuntimeSchemaTypes.ProductJobRunsExtraConfigColumns): PgTableExtraConfig => ({
    identityIndex: uniqueIndex('product_job_runs_class_identity_idx').on(table.jobClass, table.identityId),
    statusIndex: index('product_job_runs_status_created_at_idx').on(table.status, table.createdAt),
  }),
);
