import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  type PgTableExtraConfig,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { deployments } from './schema-deploy';
import { projects } from './schema-platform';
import { projectResources } from './schema-resources';
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
    state: text('state', { enum: ['desired', 'pending', 'active', 'stopping', 'stopped'] }).notNull(),
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
    runtimeIdentity: text('runtime_identity', { enum: ['project', 'resource'] })
      .default('resource')
      .notNull(),
    identityId: text('identity_id').notNull(),
    image: text('image').notNull(),
    imagePullSecretId: text('image_pull_secret_id'),
    commandJson: text('command_json').notNull(),
    envJson: text('env_json').notNull(),
    resourceIdsJson: text('resource_ids_json').default('[]').notNull(),
    volumeMountsJson: text('volume_mounts_json').default('[]').notNull(),
    namespace: text('namespace').notNull(),
    projectId: text('project_id').notNull(),
    timeoutMs: integer('timeout_ms').notNull(),
    status: text('status', { enum: ['queued', 'running', 'succeeded', 'failed', 'timed-out'] }).notNull(),
    exitCode: integer('exit_code'),
    jobName: text('job_name'),
    podName: text('pod_name'),
    logs: text('logs'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: KubeRuntimeSchemaTypes.ProductJobRunsExtraConfigColumns): PgTableExtraConfig => ({
    identityIndex: uniqueIndex('product_job_runs_class_identity_idx').on(table.jobClass, table.identityId),
    statusIndex: index('product_job_runs_status_created_at_idx').on(table.status, table.createdAt),
    projectStatusIndex: index('product_job_runs_project_status_idx').on(table.projectId, table.status),
  }),
);

export const workloadUsageHourly: KubeRuntimeSchemaTypes.WorkloadUsageHourlyTable = pgTable(
  'workload_usage_hourly',
  {
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id').notNull(),
    environmentId: text('environment_id').notNull(),
    serviceId: text('service_id'),
    resourceId: text('resource_id'),
    hourBucket: timestamp('hour_bucket', { withTimezone: true }).notNull(),
    cpuMillicoreSeconds: bigint('cpu_millicore_seconds', { mode: 'number' }).default(0).notNull(),
    memoryByteSeconds: bigint('memory_byte_seconds', { mode: 'number' }).default(0).notNull(),
    requestBytes: bigint('request_bytes', { mode: 'number' }).default(0).notNull(),
    responseBytes: bigint('response_bytes', { mode: 'number' }).default(0).notNull(),
    requestCount: bigint('request_count', { mode: 'number' }).default(0).notNull(),
    status4xxCount: bigint('status_4xx_count', { mode: 'number' }).default(0).notNull(),
    status5xxCount: bigint('status_5xx_count', { mode: 'number' }).default(0).notNull(),
    sampleCount: integer('sample_count').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: KubeRuntimeSchemaTypes.WorkloadUsageHourlyExtraConfigColumns): PgTableExtraConfig => ({
    ownerCheck: check(
      'workload_usage_hourly_owner_check',
      sql`num_nonnulls(${table.serviceId}, ${table.resourceId}) = 1`,
    ),
    applicationBucketUnique: uniqueIndex('workload_usage_hourly_application_bucket_idx')
      .on(table.organizationId, table.projectId, table.environmentId, table.serviceId, table.hourBucket)
      .where(sql`${table.serviceId} is not null`),
    resourceBucketUnique: uniqueIndex('workload_usage_hourly_resource_bucket_idx')
      .on(table.organizationId, table.projectId, table.environmentId, table.resourceId, table.hourBucket)
      .where(sql`${table.resourceId} is not null`),
    retentionIndex: index('workload_usage_hourly_bucket_idx').on(table.hourBucket),
  }),
);

export const workloadUsageCheckpoints: KubeRuntimeSchemaTypes.WorkloadUsageCheckpointsTable = pgTable(
  'workload_usage_checkpoints',
  {
    podUid: text('pod_uid').primaryKey(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: KubeRuntimeSchemaTypes.WorkloadUsageCheckpointsExtraConfigColumns): PgTableExtraConfig => ({
    retentionIndex: index('workload_usage_checkpoints_updated_at_idx').on(table.updatedAt),
  }),
);

export const jobUsageHourly: KubeRuntimeSchemaTypes.JobUsageHourlyTable = pgTable(
  'job_usage_hourly',
  {
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id').notNull(),
    environmentId: text('environment_id').notNull(),
    serviceId: text('service_id').notNull(),
    hourBucket: timestamp('hour_bucket', { withTimezone: true }).notNull(),
    jobClass: text('job_class', { enum: ['build', 'release'] }).notNull(),
    durationSeconds: bigint('duration_seconds', { mode: 'number' }).default(0).notNull(),
    jobCount: integer('job_count').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: KubeRuntimeSchemaTypes.JobUsageHourlyExtraConfigColumns): PgTableExtraConfig => ({
    bucketUnique: uniqueIndex('job_usage_hourly_bucket_idx').on(
      table.organizationId,
      table.projectId,
      table.environmentId,
      table.serviceId,
      table.hourBucket,
      table.jobClass,
    ),
    retentionIndex: index('job_usage_hourly_retention_idx').on(table.hourBucket),
  }),
);

export const jobUsageCheckpoints: KubeRuntimeSchemaTypes.JobUsageCheckpointsTable = pgTable(
  'job_usage_checkpoints',
  {
    sourceKey: text('source_key').primaryKey(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: KubeRuntimeSchemaTypes.JobUsageCheckpointsExtraConfigColumns): PgTableExtraConfig => ({
    retentionIndex: index('job_usage_checkpoints_created_at_idx').on(table.createdAt),
  }),
);

export const deploymentProductLogs: KubeRuntimeSchemaTypes.DeploymentProductLogsTable = pgTable(
  'deployment_product_logs',
  {
    deploymentId: text('deployment_id').references((): typeof deployments.id => deployments.id, {
      onDelete: 'cascade',
    }),
    resourceId: text('resource_id').references((): typeof projectResources.id => projectResources.id, {
      onDelete: 'cascade',
    }),
    appKey: text('app_key').notNull(),
    podUid: text('pod_uid').notNull(),
    podName: text('pod_name').notNull(),
    namespace: text('namespace').notNull(),
    containerName: text('container_name').notNull(),
    restartIdentity: text('restart_identity').notNull(),
    sourceFingerprint: text('source_fingerprint').notNull(),
    sourceOffset: bigint('source_offset', { mode: 'number' }).notNull(),
    stream: text('stream', { enum: ['stdout', 'stderr'] }).notNull(),
    message: text('message').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  },
  (table: KubeRuntimeSchemaTypes.DeploymentProductLogsExtraConfigColumns): PgTableExtraConfig => ({
    ownerCheck: check(
      'deployment_product_logs_owner_check',
      sql`num_nonnulls(${table.deploymentId}, ${table.resourceId}) = 1`,
    ),
    deploymentOccurredAtIndex: index('deployment_product_logs_deployment_occurred_at_idx').on(
      table.deploymentId,
      table.occurredAt,
    ),
    resourceOccurredAtIndex: index('deployment_product_logs_resource_occurred_at_idx').on(
      table.resourceId,
      table.occurredAt,
    ),
    identityOffsetIndex: uniqueIndex('deployment_product_logs_identity_offset_idx').on(
      table.podUid,
      table.containerName,
      table.restartIdentity,
      table.sourceOffset,
      table.sourceFingerprint,
    ),
    appWindowIndex: index('deployment_product_logs_app_window_idx').on(
      table.appKey,
      table.occurredAt.desc(),
      table.sourceOffset.desc(),
    ),
  }),
);

export const projectKubeProvisioning: KubeRuntimeSchemaTypes.ProjectKubeProvisioningTable = pgTable(
  'project_kube_provisioning',
  {
    projectId: text('project_id')
      .primaryKey()
      .references((): typeof projects.id => projects.id, { onDelete: 'cascade' }),
    state: text('state', {
      enum: [
        'pending',
        'running',
        'succeeded',
        'failed',
        'teardown_preparing',
        'teardown_pending',
        'teardown_running',
        'teardown_succeeded',
        'teardown_failed',
      ],
    })
      .default('pending')
      .notNull(),
    leaseId: text('lease_id'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    failureMessage: text('failure_message'),
    attempts: integer('attempts').default(0).notNull(),
    isolationVersion: integer('isolation_version')
      .default(0)
      .$defaultFn((): number => 2)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: KubeRuntimeSchemaTypes.ProjectKubeProvisioningExtraConfigColumns): PgTableExtraConfig => ({
    stateLeaseIndex: index('project_kube_provisioning_state_lease_idx').on(table.state, table.leaseExpiresAt),
  }),
);
