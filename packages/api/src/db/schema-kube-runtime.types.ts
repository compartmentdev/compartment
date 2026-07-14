import type {
  DefaultTimestampBuilder,
  DefaultEnumTextBuilder,
  DefaultTextBuilder,
  DefaultIntegerBuilder,
  OptionalIntegerBuilder,
  OptionalTextBuilder,
  OptionalTimestampBuilder,
  PgExtraConfigColumnsOf,
  PgTableOf,
  PrimaryTextBuilder,
  RequiredBigIntNumberBuilder,
  RequiredEnumTextBuilder,
  RequiredIntegerBuilder,
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
  identityId: RequiredTextBuilder<'identity_id'>;
  image: RequiredTextBuilder<'image'>;
  commandJson: RequiredTextBuilder<'command_json'>;
  envJson: RequiredTextBuilder<'env_json'>;
  volumeMountsJson: DefaultTextBuilder<'volume_mounts_json'>;
  namespace: RequiredTextBuilder<'namespace'>;
  timeoutMs: RequiredIntegerBuilder<'timeout_ms'>;
  status: RequiredEnumTextBuilder<'status', ['queued', 'running', 'succeeded', 'failed', 'timed-out']>;
  exitCode: OptionalIntegerBuilder<'exit_code'>;
  jobName: OptionalTextBuilder<'job_name'>;
  podName: OptionalTextBuilder<'pod_name'>;
  logs: OptionalTextBuilder<'logs'>;
  completedAt: OptionalTimestampBuilder<'completed_at'>;
  finalizedAt: OptionalTimestampBuilder<'finalized_at'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

export type ProductJobRunsTable = PgTableOf<'product_job_runs', ProductJobRunsColumnBuilders>;
export type ProductJobRunsExtraConfigColumns = PgExtraConfigColumnsOf<'product_job_runs', ProductJobRunsColumnBuilders>;

interface DeploymentProductLogsColumnBuilders {
  deploymentId: RequiredTextBuilder<'deployment_id'>;
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
  state: DefaultEnumTextBuilder<'state', ['pending', 'running', 'succeeded', 'failed']>;
  leaseId: OptionalTextBuilder<'lease_id'>;
  leaseExpiresAt: OptionalTimestampBuilder<'lease_expires_at'>;
  failureMessage: OptionalTextBuilder<'failure_message'>;
  attempts: DefaultIntegerBuilder<'attempts'>;
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
