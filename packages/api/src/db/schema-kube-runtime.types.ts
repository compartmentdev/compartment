import type {
  DefaultTimestampBuilder,
  DefaultTextBuilder,
  DefaultIntegerBuilder,
  OptionalIntegerBuilder,
  OptionalTextBuilder,
  OptionalTimestampBuilder,
  PgExtraConfigColumnsOf,
  PgTableOf,
  PrimaryTextBuilder,
  RequiredEnumTextBuilder,
  RequiredIntegerBuilder,
  RequiredTextBuilder,
} from './schema.shared.types';

interface DeploymentKubeReferencesColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  deploymentId: RequiredTextBuilder<'deployment_id'>;
  namespace: RequiredTextBuilder<'namespace'>;
  deploymentName: RequiredTextBuilder<'deployment_name'>;
  serviceName: RequiredTextBuilder<'service_name'>;
  networkPolicyNamesJson: RequiredTextBuilder<'network_policy_names_json'>;
  state: RequiredEnumTextBuilder<'state', ['desired', 'pending', 'active']>;
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
