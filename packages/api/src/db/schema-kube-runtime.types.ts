import type {
  DefaultTimestampBuilder,
  DefaultEnumTextBuilder,
  DefaultTextBuilder,
  DefaultIntegerBuilder,
  DefaultBigIntNumberBuilder,
  OptionalIntegerBuilder,
  OptionalTextBuilder,
  OptionalTimestampBuilder,
  PgExtraConfigColumnsOf,
  PgTableOf,
  PrimaryTextBuilder,
  RequiredBigIntNumberBuilder,
  RequiredEnumTextBuilder,
  RequiredIntegerBuilder,
  RuntimeDefaultIntegerBuilder,
  RequiredTimestampBuilder,
  RequiredTextBuilder,
} from './schema.shared.types';

interface DeploymentKubeReferencesColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  deploymentId: RequiredTextBuilder<'deployment_id'>;
  namespace: RequiredTextBuilder<'namespace'>;
  deploymentName: RequiredTextBuilder<'deployment_name'>;
  serviceName: RequiredTextBuilder<'service_name'>;
  networkPolicyNamesJson: RequiredTextBuilder<'network_policy_names_json'>;
  state: RequiredEnumTextBuilder<'state', ['desired', 'pending', 'active', 'stopping', 'stopped']>;
  revision: DefaultIntegerBuilder<'revision'>;
  observedAt: OptionalTimestampBuilder<'observed_at'>;
  transitionedAt: DefaultTimestampBuilder<'transitioned_at'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

export type DeploymentKubeReferencesTable = PgTableOf<
  'deployment_kube_references',
  DeploymentKubeReferencesColumnBuilders
>;
export type DeploymentKubeReferencesExtraConfigColumns = PgExtraConfigColumnsOf<
  'deployment_kube_references',
  DeploymentKubeReferencesColumnBuilders
>;

interface ProductJobRunsColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  jobClass: RequiredEnumTextBuilder<'job_class', ['release', 'resource-operation']>;
  runtimeIdentity: DefaultEnumTextBuilder<'runtime_identity', ['project', 'resource']>;
  identityId: RequiredTextBuilder<'identity_id'>;
  image: RequiredTextBuilder<'image'>;
  imagePullSecretId: OptionalTextBuilder<'image_pull_secret_id'>;
  commandJson: RequiredTextBuilder<'command_json'>;
  envJson: RequiredTextBuilder<'env_json'>;
  resourceIdsJson: DefaultTextBuilder<'resource_ids_json'>;
  volumeMountsJson: DefaultTextBuilder<'volume_mounts_json'>;
  namespace: RequiredTextBuilder<'namespace'>;
  projectId: RequiredTextBuilder<'project_id'>;
  timeoutMs: RequiredIntegerBuilder<'timeout_ms'>;
  status: RequiredEnumTextBuilder<'status', ['queued', 'running', 'succeeded', 'failed', 'timed-out']>;
  exitCode: OptionalIntegerBuilder<'exit_code'>;
  jobName: OptionalTextBuilder<'job_name'>;
  podName: OptionalTextBuilder<'pod_name'>;
  logs: OptionalTextBuilder<'logs'>;
  completedAt: OptionalTimestampBuilder<'completed_at'>;
  startedAt: OptionalTimestampBuilder<'started_at'>;
  finalizedAt: OptionalTimestampBuilder<'finalized_at'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

export type ProductJobRunsTable = PgTableOf<'product_job_runs', ProductJobRunsColumnBuilders>;
export type ProductJobRunsExtraConfigColumns = PgExtraConfigColumnsOf<'product_job_runs', ProductJobRunsColumnBuilders>;

interface WorkloadUsageHourlyColumnBuilders {
  organizationId: RequiredTextBuilder<'organization_id'>;
  projectId: RequiredTextBuilder<'project_id'>;
  environmentId: RequiredTextBuilder<'environment_id'>;
  serviceId: OptionalTextBuilder<'service_id'>;
  resourceId: OptionalTextBuilder<'resource_id'>;
  hourBucket: RequiredTimestampBuilder<'hour_bucket'>;
  cpuMillicoreSeconds: DefaultBigIntNumberBuilder<'cpu_millicore_seconds'>;
  memoryByteSeconds: DefaultBigIntNumberBuilder<'memory_byte_seconds'>;
  requestBytes: DefaultBigIntNumberBuilder<'request_bytes'>;
  responseBytes: DefaultBigIntNumberBuilder<'response_bytes'>;
  requestCount: DefaultBigIntNumberBuilder<'request_count'>;
  status4xxCount: DefaultBigIntNumberBuilder<'status_4xx_count'>;
  status5xxCount: DefaultBigIntNumberBuilder<'status_5xx_count'>;
  sampleCount: DefaultIntegerBuilder<'sample_count'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

export type WorkloadUsageHourlyTable = PgTableOf<'workload_usage_hourly', WorkloadUsageHourlyColumnBuilders>;
export type WorkloadUsageHourlyExtraConfigColumns = PgExtraConfigColumnsOf<
  'workload_usage_hourly',
  WorkloadUsageHourlyColumnBuilders
>;

interface WorkloadUsageCheckpointsColumnBuilders {
  podUid: PrimaryTextBuilder<'pod_uid'>;
  observedAt: RequiredTimestampBuilder<'observed_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

export type WorkloadUsageCheckpointsTable = PgTableOf<
  'workload_usage_checkpoints',
  WorkloadUsageCheckpointsColumnBuilders
>;
export type WorkloadUsageCheckpointsExtraConfigColumns = PgExtraConfigColumnsOf<
  'workload_usage_checkpoints',
  WorkloadUsageCheckpointsColumnBuilders
>;

interface JobUsageHourlyColumnBuilders {
  organizationId: RequiredTextBuilder<'organization_id'>;
  projectId: RequiredTextBuilder<'project_id'>;
  environmentId: RequiredTextBuilder<'environment_id'>;
  serviceId: RequiredTextBuilder<'service_id'>;
  hourBucket: RequiredTimestampBuilder<'hour_bucket'>;
  jobClass: RequiredEnumTextBuilder<'job_class', ['build', 'release']>;
  durationSeconds: DefaultBigIntNumberBuilder<'duration_seconds'>;
  jobCount: DefaultIntegerBuilder<'job_count'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

export type JobUsageHourlyTable = PgTableOf<'job_usage_hourly', JobUsageHourlyColumnBuilders>;
export type JobUsageHourlyExtraConfigColumns = PgExtraConfigColumnsOf<'job_usage_hourly', JobUsageHourlyColumnBuilders>;

interface JobUsageCheckpointsColumnBuilders {
  sourceKey: PrimaryTextBuilder<'source_key'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
}

export type JobUsageCheckpointsTable = PgTableOf<'job_usage_checkpoints', JobUsageCheckpointsColumnBuilders>;
export type JobUsageCheckpointsExtraConfigColumns = PgExtraConfigColumnsOf<
  'job_usage_checkpoints',
  JobUsageCheckpointsColumnBuilders
>;

interface DeploymentProductLogsColumnBuilders {
  deploymentId: OptionalTextBuilder<'deployment_id'>;
  resourceId: OptionalTextBuilder<'resource_id'>;
  podUid: RequiredTextBuilder<'pod_uid'>;
  podName: RequiredTextBuilder<'pod_name'>;
  namespace: RequiredTextBuilder<'namespace'>;
  containerName: RequiredTextBuilder<'container_name'>;
  restartIdentity: RequiredTextBuilder<'restart_identity'>;
  sourceFingerprint: RequiredTextBuilder<'source_fingerprint'>;
  sourceOffset: RequiredBigIntNumberBuilder<'source_offset'>;
  stream: RequiredEnumTextBuilder<'stream', ['stdout', 'stderr']>;
  message: RequiredTextBuilder<'message'>;
  occurredAt: RequiredTimestampBuilder<'occurred_at'>;
  capturedAt: DefaultTimestampBuilder<'captured_at'>;
}

export type DeploymentProductLogsTable = PgTableOf<'deployment_product_logs', DeploymentProductLogsColumnBuilders>;
export type DeploymentProductLogsExtraConfigColumns = PgExtraConfigColumnsOf<
  'deployment_product_logs',
  DeploymentProductLogsColumnBuilders
>;

interface ProductLogStoreQuotaColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  usedBytes: DefaultIntegerBuilder<'used_bytes'>;
}

export type ProductLogStoreQuotaTable = PgTableOf<'product_log_store_quota', ProductLogStoreQuotaColumnBuilders>;

interface ProjectKubeProvisioningColumnBuilders {
  projectId: PrimaryTextBuilder<'project_id'>;
  state: DefaultEnumTextBuilder<
    'state',
    [
      'pending',
      'running',
      'succeeded',
      'failed',
      'teardown_preparing',
      'teardown_pending',
      'teardown_running',
      'teardown_succeeded',
      'teardown_failed',
    ]
  >;
  leaseId: OptionalTextBuilder<'lease_id'>;
  leaseExpiresAt: OptionalTimestampBuilder<'lease_expires_at'>;
  failureMessage: OptionalTextBuilder<'failure_message'>;
  attempts: DefaultIntegerBuilder<'attempts'>;
  isolationVersion: RuntimeDefaultIntegerBuilder<'isolation_version'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

export type ProjectKubeProvisioningTable = PgTableOf<
  'project_kube_provisioning',
  ProjectKubeProvisioningColumnBuilders
>;
export type ProjectKubeProvisioningExtraConfigColumns = PgExtraConfigColumnsOf<
  'project_kube_provisioning',
  ProjectKubeProvisioningColumnBuilders
>;

interface OrganizationQuotaReconciliationColumnBuilders {
  organizationId: PrimaryTextBuilder<'organization_id'>;
  state: DefaultEnumTextBuilder<'state', ['pending', 'running', 'succeeded', 'failed']>;
  leaseId: OptionalTextBuilder<'lease_id'>;
  leaseExpiresAt: OptionalTimestampBuilder<'lease_expires_at'>;
  failureMessage: OptionalTextBuilder<'failure_message'>;
  attempts: DefaultIntegerBuilder<'attempts'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

export type OrganizationQuotaReconciliationTable = PgTableOf<
  'organization_quota_reconciliation',
  OrganizationQuotaReconciliationColumnBuilders
>;
export type OrganizationQuotaReconciliationExtraConfigColumns = PgExtraConfigColumnsOf<
  'organization_quota_reconciliation',
  OrganizationQuotaReconciliationColumnBuilders
>;
