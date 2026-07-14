import type {
  DefaultBooleanBuilder,
  DefaultIntegerBuilder,
  DefaultTextBuilder,
  DefaultTimestampBuilder,
  OptionalTextBuilder,
  OptionalTimestampBuilder,
  PgExtraConfigColumnsOf,
  PgTableOf,
  PrimaryTextBuilder,
  RequiredEnumTextBuilder,
  RequiredTextBuilder,
} from './schema.shared.types';

interface SourcesColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  organizationId: RequiredTextBuilder<'organization_id'>;
  type: RequiredEnumTextBuilder<'type', ['git']>;
  providerHost: RequiredTextBuilder<'provider_host'>;
  providerRegistrationId: RequiredTextBuilder<'provider_registration_id'>;
  providerInstallationId: OptionalTextBuilder<'provider_installation_id'>;
  providerWebhookId: OptionalTextBuilder<'provider_webhook_id'>;
  repositoryExternalId: RequiredTextBuilder<'repository_external_id'>;
  repositoryOwner: RequiredTextBuilder<'repository_owner'>;
  repositoryName: RequiredTextBuilder<'repository_name'>;
  repositoryCloneUrl: RequiredTextBuilder<'repository_clone_url'>;
  displayName: RequiredTextBuilder<'display_name'>;
  status: RequiredEnumTextBuilder<'status', ['active', 'disabled', 'disconnected']>;
  defaultBranchName: RequiredTextBuilder<'default_branch_name'>;
  syncBranchName: RequiredTextBuilder<'sync_branch_name'>;
  autoAdoptNewApps: DefaultBooleanBuilder<'auto_adopt_new_apps'>;
  defaultEnvironmentName: RequiredTextBuilder<'default_environment_name'>;
  defaultAutoDeployEnabled: DefaultBooleanBuilder<'default_auto_deploy_enabled'>;
  lastSyncAt: OptionalTimestampBuilder<'last_sync_at'>;
  automationPrincipalId: OptionalTextBuilder<'automation_principal_id'>;
  disconnectedAt: OptionalTimestampBuilder<'disconnected_at'>;
  createdByPrincipalId: RequiredTextBuilder<'created_by_principal_id'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

interface SourceBindingsColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  sourceId: RequiredTextBuilder<'source_id'>;
  projectId: OptionalTextBuilder<'project_id'>;
  projectName: RequiredTextBuilder<'project_name'>;
  descriptorPath: RequiredTextBuilder<'descriptor_path'>;
  descriptorDirectory: RequiredTextBuilder<'descriptor_directory'>;
  watchPathsJson: DefaultTextBuilder<'watch_paths_json'>;
  status: RequiredEnumTextBuilder<'status', ['active', 'disconnected']>;
  autoDeployEnabled: DefaultBooleanBuilder<'auto_deploy_enabled'>;
  disconnectedAt: OptionalTimestampBuilder<'disconnected_at'>;
  createdByPrincipalId: RequiredTextBuilder<'created_by_principal_id'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

interface SourceExcludedDescriptorsColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  sourceId: RequiredTextBuilder<'source_id'>;
  descriptorPath: RequiredTextBuilder<'descriptor_path'>;
  createdByPrincipalId: RequiredTextBuilder<'created_by_principal_id'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

interface SourceBindingBranchMappingsColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  sourceBindingId: RequiredTextBuilder<'source_binding_id'>;
  branchName: RequiredTextBuilder<'branch_name'>;
  environmentName: RequiredTextBuilder<'environment_name'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

interface SourceEventsColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  sourceId: RequiredTextBuilder<'source_id'>;
  providerDeliveryId: RequiredTextBuilder<'provider_delivery_id'>;
  eventType: RequiredEnumTextBuilder<'event_type', ['push', 'source_sync']>;
  branchName: OptionalTextBuilder<'branch_name'>;
  commitSha: OptionalTextBuilder<'commit_sha'>;
  changedFilesJson: DefaultTextBuilder<'changed_files_json'>;
  changedFilesComplete: DefaultBooleanBuilder<'changed_files_complete'>;
  payloadJson: RequiredTextBuilder<'payload_json'>;
  status: RequiredEnumTextBuilder<'status', ['received', 'tasks_created', 'completed']>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
  completedAt: OptionalTimestampBuilder<'completed_at'>;
}

interface SourceResolutionTasksColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  sourceEventId: RequiredTextBuilder<'source_event_id'>;
  sourceId: RequiredTextBuilder<'source_id'>;
  sourceBindingId: RequiredTextBuilder<'source_binding_id'>;
  commitSha: RequiredTextBuilder<'commit_sha'>;
  branchName: RequiredTextBuilder<'branch_name'>;
  targetEnvironmentName: RequiredTextBuilder<'target_environment_name'>;
  status: RequiredEnumTextBuilder<'status', ['pending', 'claimed', 'completed', 'failed', 'canceled']>;
  claimantId: OptionalTextBuilder<'claimant_id'>;
  claimedAt: OptionalTimestampBuilder<'claimed_at'>;
  leaseExpiresAt: OptionalTimestampBuilder<'lease_expires_at'>;
  attemptCount: DefaultIntegerBuilder<'attempt_count'>;
  maxAttempts: DefaultIntegerBuilder<'max_attempts'>;
  failureReason: OptionalTextBuilder<'failure_reason'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
  completedAt: OptionalTimestampBuilder<'completed_at'>;
}

interface SourceResolutionTaskDeploymentsColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  sourceResolutionTaskId: RequiredTextBuilder<'source_resolution_task_id'>;
  deploymentId: RequiredTextBuilder<'deployment_id'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
}

interface SourceSyncTasksColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  sourceId: RequiredTextBuilder<'source_id'>;
  requestedByPrincipalId: RequiredTextBuilder<'requested_by_principal_id'>;
  requestedBranchName: RequiredTextBuilder<'requested_branch_name'>;
  adoptionMode: RequiredEnumTextBuilder<'adoption_mode', ['bootstrap', 'incremental']>;
  requestedDescriptorPathsJson: DefaultTextBuilder<'requested_descriptor_paths_json'>;
  resolvedCommitSha: OptionalTextBuilder<'resolved_commit_sha'>;
  triggerSourceEventId: OptionalTextBuilder<'trigger_source_event_id'>;
  triggerCommitSha: OptionalTextBuilder<'trigger_commit_sha'>;
  status: RequiredEnumTextBuilder<'status', ['pending', 'claimed', 'completed', 'failed', 'canceled']>;
  claimedByWorkerId: OptionalTextBuilder<'claimed_by_worker_id'>;
  claimedAt: OptionalTimestampBuilder<'claimed_at'>;
  leaseExpiresAt: OptionalTimestampBuilder<'lease_expires_at'>;
  attemptCount: DefaultIntegerBuilder<'attempt_count'>;
  maxAttempts: DefaultIntegerBuilder<'max_attempts'>;
  failureReason: OptionalTextBuilder<'failure_reason'>;
  completedAt: OptionalTimestampBuilder<'completed_at'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

interface SourceSyncTaskCandidatesColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  sourceSyncTaskId: RequiredTextBuilder<'source_sync_task_id'>;
  descriptorPath: RequiredTextBuilder<'descriptor_path'>;
  descriptorDirectory: RequiredTextBuilder<'descriptor_directory'>;
  projectName: OptionalTextBuilder<'project_name'>;
  derivedWatchPathsJson: DefaultTextBuilder<'derived_watch_paths_json'>;
  blockedReason: OptionalTextBuilder<'blocked_reason'>;
  status: RequiredEnumTextBuilder<'status', ['accepted', 'blocked']>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

export type SourcesTable = PgTableOf<'sources', SourcesColumnBuilders>;
export type SourcesExtraConfigColumns = PgExtraConfigColumnsOf<'sources', SourcesColumnBuilders>;
export type SourceBindingsTable = PgTableOf<'source_bindings', SourceBindingsColumnBuilders>;
export type SourceBindingsExtraConfigColumns = PgExtraConfigColumnsOf<'source_bindings', SourceBindingsColumnBuilders>;
export type SourceExcludedDescriptorsTable = PgTableOf<
  'source_excluded_descriptors',
  SourceExcludedDescriptorsColumnBuilders
>;
export type SourceExcludedDescriptorsExtraConfigColumns = PgExtraConfigColumnsOf<
  'source_excluded_descriptors',
  SourceExcludedDescriptorsColumnBuilders
>;
export type SourceBindingBranchMappingsTable = PgTableOf<
  'source_binding_branch_mappings',
  SourceBindingBranchMappingsColumnBuilders
>;
export type SourceBindingBranchMappingsExtraConfigColumns = PgExtraConfigColumnsOf<
  'source_binding_branch_mappings',
  SourceBindingBranchMappingsColumnBuilders
>;
export type SourceEventsTable = PgTableOf<'source_events', SourceEventsColumnBuilders>;
export type SourceEventsExtraConfigColumns = PgExtraConfigColumnsOf<'source_events', SourceEventsColumnBuilders>;
export type SourceResolutionTasksTable = PgTableOf<'source_resolution_tasks', SourceResolutionTasksColumnBuilders>;
export type SourceResolutionTasksExtraConfigColumns = PgExtraConfigColumnsOf<
  'source_resolution_tasks',
  SourceResolutionTasksColumnBuilders
>;
export type SourceResolutionTaskDeploymentsTable = PgTableOf<
  'source_resolution_task_deployments',
  SourceResolutionTaskDeploymentsColumnBuilders
>;
export type SourceResolutionTaskDeploymentsExtraConfigColumns = PgExtraConfigColumnsOf<
  'source_resolution_task_deployments',
  SourceResolutionTaskDeploymentsColumnBuilders
>;
export type SourceSyncTasksTable = PgTableOf<'source_sync_tasks', SourceSyncTasksColumnBuilders>;
export type SourceSyncTasksExtraConfigColumns = PgExtraConfigColumnsOf<
  'source_sync_tasks',
  SourceSyncTasksColumnBuilders
>;
export type SourceSyncTaskCandidatesTable = PgTableOf<
  'source_sync_task_candidates',
  SourceSyncTaskCandidatesColumnBuilders
>;
export type SourceSyncTaskCandidatesExtraConfigColumns = PgExtraConfigColumnsOf<
  'source_sync_task_candidates',
  SourceSyncTaskCandidatesColumnBuilders
>;
