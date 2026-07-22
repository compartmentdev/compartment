import type {
  DefaultBooleanBuilder,
  DefaultEnumTextBuilder,
  DefaultIntegerBuilder,
  DefaultTextBuilder,
  DefaultTimestampBuilder,
  OptionalIntegerBuilder,
  OptionalTextBuilder,
  OptionalTimestampBuilder,
  PgExtraConfigColumnsOf,
  PgTableOf,
  PrimaryTextBuilder,
  RequiredEnumTextBuilder,
  RequiredIntegerBuilder,
  RequiredTextBuilder,
  RequiredTimestampBuilder,
} from './schema.shared.types';

interface BuildArtifactsColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  projectId: RequiredTextBuilder<'project_id'>;
  projectServiceId: RequiredTextBuilder<'project_service_id'>;
  createdByPrincipalId: OptionalTextBuilder<'created_by_principal_id'>;
  sourceUploadId: OptionalTextBuilder<'source_upload_id'>;
  sourceDigest: RequiredTextBuilder<'source_digest'>;
  resolvedBuildJson: RequiredTextBuilder<'resolved_build_json'>;
  resolvedBuildEnvJson: RequiredTextBuilder<'resolved_build_env_json'>;
  imageRepository: RequiredTextBuilder<'image_repository'>;
  imageRef: OptionalTextBuilder<'image_ref'>;
  imageRetentionState: DefaultTextBuilder<'image_retention_state'>;
  imageCleanedAt: OptionalTimestampBuilder<'image_cleaned_at'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

interface SourceUploadsColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  organizationId: RequiredTextBuilder<'organization_id'>;
  createdByPrincipalId: OptionalTextBuilder<'created_by_principal_id'>;
  projectId: OptionalTextBuilder<'project_id'>;
  environmentId: OptionalTextBuilder<'environment_id'>;
  projectServiceId: OptionalTextBuilder<'project_service_id'>;
  sourceDigest: RequiredTextBuilder<'source_digest'>;
  byteSize: RequiredIntegerBuilder<'byte_size'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  expiresAt: RequiredTimestampBuilder<'expires_at'>;
  consumedAt: OptionalTimestampBuilder<'consumed_at'>;
}

export interface DeploymentSourceProvenanceColumnBuilders {
  sourceAutomationPrincipalId: OptionalTextBuilder<'source_automation_principal_id'>;
  sourceBindingId: OptionalTextBuilder<'source_binding_id'>;
  sourceBindingSnapshotJson: OptionalTextBuilder<'source_binding_snapshot_json'>;
  sourceCommitSha: OptionalTextBuilder<'source_commit_sha'>;
  sourceEventId: OptionalTextBuilder<'source_event_id'>;
  sourceId: OptionalTextBuilder<'source_id'>;
  sourceKind: OptionalTextBuilder<'source_kind'>;
  sourceRepositorySnapshotJson: OptionalTextBuilder<'source_repository_snapshot_json'>;
  sourceResolutionTaskId: OptionalTextBuilder<'source_resolution_task_id'>;
}

interface DeploymentRunsColumnBuilders extends DeploymentSourceProvenanceColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  environmentId: RequiredTextBuilder<'environment_id'>;
  label: OptionalTextBuilder<'label'>;
  onboardingSessionId: OptionalTextBuilder<'onboarding_session_id'>;
  triggerType: RequiredTextBuilder<'trigger_type'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

interface DeploymentsColumnBuilders extends DeploymentSourceProvenanceColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  deploymentRunId: RequiredTextBuilder<'deployment_run_id'>;
  environmentId: RequiredTextBuilder<'environment_id'>;
  buildArtifactId: RequiredTextBuilder<'build_artifact_id'>;
  projectServiceId: RequiredTextBuilder<'project_service_id'>;
  operationId: RequiredTextBuilder<'operation_id'>;
  status: RequiredTextBuilder<'status'>;
  health: RequiredTextBuilder<'health'>;
  label: OptionalTextBuilder<'label'>;
  failureMessage: OptionalTextBuilder<'failure_message'>;
  accessMode: DefaultEnumTextBuilder<'access_mode', ['authenticated', 'public']>;
  isActive: DefaultBooleanBuilder<'is_active'>;
  resolvedReadinessJson: RequiredTextBuilder<'resolved_readiness_json'>;
  resolvedReleaseJson: DefaultTextBuilder<'resolved_release_json'>;
  resolvedRunJson: RequiredTextBuilder<'resolved_run_json'>;
  resolvedRoutesJson: DefaultTextBuilder<'resolved_routes_json'>;
  promotionStage: RequiredTextBuilder<'promotion_stage'>;
  movementSourceDeploymentId: OptionalTextBuilder<'movement_source_deployment_id'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
  completedAt: OptionalTimestampBuilder<'completed_at'>;
}

interface DeploymentRunEventsColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  deploymentRunId: RequiredTextBuilder<'deployment_run_id'>;
  deploymentId: OptionalTextBuilder<'deployment_id'>;
  level: RequiredTextBuilder<'level'>;
  message: RequiredTextBuilder<'message'>;
  status: OptionalTextBuilder<'status'>;
  stepKey: RequiredTextBuilder<'step_key'>;
  stream: RequiredTextBuilder<'stream'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
}

interface DeploymentMovementOrganizationStateColumnBuilders {
  organizationId: PrimaryTextBuilder<'organization_id'>;
  lastClaimedAt: RequiredTimestampBuilder<'last_claimed_at'>;
}

interface DeploymentRoutesColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  deploymentId: RequiredTextBuilder<'deployment_id'>;
  subdomain: RequiredTextBuilder<'subdomain'>;
  accessScopeType: RequiredEnumTextBuilder<'access_scope_type', ['organization', 'project', 'environment']>;
  accessScopeId: RequiredTextBuilder<'access_scope_id'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

interface DeploymentCustomDomainsColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  environmentId: RequiredTextBuilder<'environment_id'>;
  projectServiceId: RequiredTextBuilder<'project_service_id'>;
  host: RequiredTextBuilder<'host'>;
  verificationTokenHash: RequiredTextBuilder<'verification_token_hash'>;
  ownershipStatus: RequiredEnumTextBuilder<'ownership_status', ['pending', 'valid', 'invalid']>;
  routingStatus: RequiredEnumTextBuilder<'routing_status', ['pending', 'valid', 'invalid']>;
  lastCheckedAt: OptionalTimestampBuilder<'last_checked_at'>;
  verifiedAt: OptionalTimestampBuilder<'verified_at'>;
  failureMessage: OptionalTextBuilder<'failure_message'>;
  createdByPrincipalId: OptionalTextBuilder<'created_by_principal_id'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

interface ProjectResourcesColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  environmentId: RequiredTextBuilder<'environment_id'>;
  name: RequiredTextBuilder<'name'>;
  image: RequiredTextBuilder<'image'>;
  commandJson: RequiredTextBuilder<'command_json'>;
  envJson: RequiredTextBuilder<'env_json'>;
  operationsJson: DefaultTextBuilder<'operations_json'>;
  operationConfigHash: DefaultTextBuilder<'operation_config_hash'>;
  outputsJson: DefaultTextBuilder<'outputs_json'>;
  portsJson: RequiredTextBuilder<'ports_json'>;
  volumesJson: RequiredTextBuilder<'volumes_json'>;
  readinessJson: RequiredTextBuilder<'readiness_json'>;
  runtimeDefinitionHash: RequiredTextBuilder<'runtime_definition_hash'>;
  expectedClaimsJson: DefaultTextBuilder<'expected_claims_json'>;
  deleteDataRequested: DefaultBooleanBuilder<'delete_data_requested'>;
  status: RequiredEnumTextBuilder<'status', ['deleting', 'running', 'starting', 'stopped']>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

interface ResourceReconcileRunsColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  projectResourceId: RequiredTextBuilder<'project_resource_id'>;
  intentJson: RequiredTextBuilder<'intent_json'>;
  expectedClaimsJson: RequiredTextBuilder<'expected_claims_json'>;
  previousManifestJson: OptionalTextBuilder<'previous_manifest_json'>;
  operationType: RequiredEnumTextBuilder<'operation_type', ['bootstrap', 'reconcile']>;
  leaseId: OptionalTextBuilder<'lease_id'>;
  leaseExpiresAt: OptionalTimestampBuilder<'lease_expires_at'>;
  phase: RequiredEnumTextBuilder<'phase', ['bootstrap-pending', 'reconcile-pending', 'running', 'succeeded', 'failed']>;
  failureMessage: OptionalTextBuilder<'failure_message'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

interface ResourceBackupsColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  projectResourceId: RequiredTextBuilder<'project_resource_id'>;
  operationId: RequiredTextBuilder<'operation_id'>;
  createdByPrincipalId: OptionalTextBuilder<'created_by_principal_id'>;
  purpose: RequiredEnumTextBuilder<'purpose', ['manual', 'pre_restore', 'scheduled']>;
  status: RequiredEnumTextBuilder<'status', ['running', 'succeeded', 'failed', 'deleted']>;
  artifactLocation: OptionalTextBuilder<'artifact_location'>;
  checksum: OptionalTextBuilder<'checksum'>;
  sizeBytes: OptionalIntegerBuilder<'size_bytes'>;
  manifestJson: OptionalTextBuilder<'manifest_json'>;
  resourceDefinitionJson: OptionalTextBuilder<'resource_definition_json'>;
  failureSummary: OptionalTextBuilder<'failure_summary'>;
  retentionAttempts: DefaultIntegerBuilder<'retention_attempts'>;
  retentionDeletedAt: OptionalTimestampBuilder<'retention_deleted_at'>;
  retentionFailureSummary: OptionalTextBuilder<'retention_failure_summary'>;
  retentionNextAttemptAt: OptionalTimestampBuilder<'retention_next_attempt_at'>;
  retentionReason: OptionalTextBuilder<'retention_reason'>;
  stdoutSummary: OptionalTextBuilder<'stdout_summary'>;
  stderrSummary: OptionalTextBuilder<'stderr_summary'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  completedAt: OptionalTimestampBuilder<'completed_at'>;
}

export type BuildArtifactsTable = PgTableOf<'build_artifacts', BuildArtifactsColumnBuilders>;
export type BuildArtifactsExtraConfigColumns = PgExtraConfigColumnsOf<'build_artifacts', BuildArtifactsColumnBuilders>;
export type SourceUploadsTable = PgTableOf<'source_uploads', SourceUploadsColumnBuilders>;
export type SourceUploadsExtraConfigColumns = PgExtraConfigColumnsOf<'source_uploads', SourceUploadsColumnBuilders>;
export type DeploymentRunsTable = PgTableOf<'deployment_runs', DeploymentRunsColumnBuilders>;
export type DeploymentRunsExtraConfigColumns = PgExtraConfigColumnsOf<'deployment_runs', DeploymentRunsColumnBuilders>;
export type DeploymentsTable = PgTableOf<'deployments', DeploymentsColumnBuilders>;
export type DeploymentsExtraConfigColumns = PgExtraConfigColumnsOf<'deployments', DeploymentsColumnBuilders>;
export type DeploymentMovementOrganizationStateTable = PgTableOf<
  'deployment_movement_organization_state',
  DeploymentMovementOrganizationStateColumnBuilders
>;
export type DeploymentMovementOrganizationStateExtraConfigColumns = PgExtraConfigColumnsOf<
  'deployment_movement_organization_state',
  DeploymentMovementOrganizationStateColumnBuilders
>;
export type DeploymentRunEventsTable = PgTableOf<'deployment_run_events', DeploymentRunEventsColumnBuilders>;
export type DeploymentRunEventsExtraConfigColumns = PgExtraConfigColumnsOf<
  'deployment_run_events',
  DeploymentRunEventsColumnBuilders
>;
export type DeploymentRoutesTable = PgTableOf<'deployment_routes', DeploymentRoutesColumnBuilders>;
export type DeploymentCustomDomainsTable = PgTableOf<
  'deployment_custom_domains',
  DeploymentCustomDomainsColumnBuilders
>;
export type DeploymentCustomDomainsExtraConfigColumns = PgExtraConfigColumnsOf<
  'deployment_custom_domains',
  DeploymentCustomDomainsColumnBuilders
>;
export type ProjectResourcesTable = PgTableOf<'project_resources', ProjectResourcesColumnBuilders>;
export type ProjectResourcesExtraConfigColumns = PgExtraConfigColumnsOf<
  'project_resources',
  ProjectResourcesColumnBuilders
>;
export type ResourceReconcileRunsTable = PgTableOf<'resource_reconcile_runs', ResourceReconcileRunsColumnBuilders>;
export type ResourceReconcileRunsExtraConfigColumns = PgExtraConfigColumnsOf<
  'resource_reconcile_runs',
  ResourceReconcileRunsColumnBuilders
>;
export type ResourceBackupsTable = PgTableOf<'resource_backups', ResourceBackupsColumnBuilders>;
export type ResourceBackupsExtraConfigColumns = PgExtraConfigColumnsOf<
  'resource_backups',
  ResourceBackupsColumnBuilders
>;
