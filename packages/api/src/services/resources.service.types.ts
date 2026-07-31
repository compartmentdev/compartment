import type {
  CompartmentAuthoredDescriptor,
  ResourceBackupPurpose,
  ResourceListQuery,
  ResourceOutputQuery,
  ResourceTargetQuery,
  ResourceLogsQuery,
  ResourceDeleteRequest,
  ResourceBackupShowQuery,
  ResourceRestoreAsRequest,
  ResourceRestoreRequest,
} from '@compartment/contracts';
import type { ResourceBackupRow } from '../queries/resource-backups.query.types';
import type { EnvironmentRow } from '../queries/deployments.query.types';
import type { OrganizationRow } from '../queries/organizations.query.types';
import type { ProjectRow } from '../queries/projects.query.types';
import type { ProjectResourceRow } from '../queries/resources.query.types';
import type { DeploymentResourceSummaryInput } from './presenter.types';

export interface ResourceEnvironmentContext {
  environment: EnvironmentRow;
  organization: OrganizationRow;
  project: ProjectRow;
}

export interface ResourceLookupResult extends ResourceEnvironmentContext {
  resource: ProjectResourceRow;
}

export interface ResourceDeleteResult extends ResourceLookupResult {
  retainedVolumes: string[];
}

export interface ResourceListResult extends ResourceEnvironmentContext {
  resources: ProjectResourceRow[];
}

export interface ResourceLogsResult extends ResourceLookupResult {
  lines: ResourceLogLineInput[];
}

export interface ResourceOutputSummaryInput {
  name: string;
  sensitivity: 'plain' | 'sensitive';
  value: string | null;
  valueFingerprint: string | null;
  valueHidden: boolean;
}

export interface ResourceOutputListResult extends ResourceLookupResult {
  outputs: ResourceOutputSummaryInput[];
}

export interface ResourceOutputResult extends ResourceLookupResult {
  output: ResourceOutputSummaryInput;
}

export interface ResourceBackupResult extends ResourceLookupResult {
  backup: ResourceBackupRow;
  manifest: string | null;
}

export interface ResourceBackupListResult extends ResourceLookupResult {
  backups: ResourceBackupRow[];
}

export interface ResourceBackupRetentionCleanup {
  backup: ResourceBackupRow;
  reason: string;
}

export interface ResourceBackupRetentionResult {
  attempted: boolean;
  cleanedBackups: ResourceBackupRetentionCleanup[];
  recordedFailure: boolean;
}

export interface ScheduledResourceBackupRunResult extends ResourceLookupResult {
  backup: ResourceBackupRow | null;
  cleanedBackups: ResourceBackupRetentionCleanup[];
  manifest: string | null;
  recordedFailure: boolean;
}

export interface ResourceRestoreResult extends ResourceLookupResult {
  preRestoreBackup: ResourceBackupRow;
  restoredBackup: ResourceBackupRow;
}

export interface ResourceRestoreAsResult extends ResourceLookupResult {
  restoredBackup: ResourceBackupRow;
  sourceResource: ProjectResourceRow;
}

export interface ResourceLogLineInput {
  message: string;
  resourceName: string;
  stream: 'stdout' | 'stderr';
  timestamp: string;
}

export interface ReconcileResourcesInput {
  actorPrincipalId: string;
  descriptor: CompartmentAuthoredDescriptor;
  environmentName?: string | undefined;
  organizationSlug: string;
}

export interface ResourceActionInput {
  actorPrincipalId: string;
  organizationSlug: string;
  query: ResourceTargetQuery;
}

export interface ResourceListInput {
  actorPrincipalId: string;
  organizationSlug: string;
  query: ResourceListQuery;
}

export interface ResourceDeleteInput extends ResourceActionInput {
  body: ResourceDeleteRequest;
}

export interface ResourceBackupShowInput {
  actorPrincipalId: string;
  organizationSlug: string;
  query: ResourceBackupShowQuery;
}

export interface ResourceRestoreInput extends ResourceActionInput {
  body: ResourceRestoreRequest;
}

export interface ResourceRestoreAsInput extends ResourceBackupShowInput {
  body: ResourceRestoreAsRequest;
}

export interface ResourceLogsInput {
  actorPrincipalId: string;
  organizationSlug: string;
  query: ResourceLogsQuery;
}

export interface ResourceOutputInput {
  actorPrincipalId: string;
  organizationSlug: string;
  query: ResourceOutputQuery;
}

export type ResourceSummaryInput = DeploymentResourceSummaryInput;
export type ResourceResponseInput = ResourceLookupResult;
export type ResourceListResponseInput = ResourceListResult;
export type ResourceOutputListResponseInput = ResourceOutputListResult;
export type ResourceOutputResponseInput = ResourceOutputResult;
export type ResourceBackupResponseInput = ResourceBackupResult;
export type ResourceBackupListResponseInput = ResourceBackupListResult;
export type ResourceRestoreResponseInput = ResourceRestoreResult;
export type ResourceRestoreAsResponseInput = ResourceRestoreAsResult;
export type ResourceBackupSummaryInput = ResourceBackupRow;

export interface RunResourceBackupInput {
  actorPrincipalId: string | null;
  context: ResourceEnvironmentContext;
  purpose: ResourceBackupPurpose;
  resource: ProjectResourceRow;
}

export interface RunResourceRestoreInput {
  artifactResource?: ProjectResourceRow | undefined;
  backup: ResourceBackupRow;
  context: ResourceEnvironmentContext;
  resource: ProjectResourceRow;
}

export interface ResourceOperationOutputError extends Error {
  stderr?: string | undefined;
  stdout?: string | undefined;
}
