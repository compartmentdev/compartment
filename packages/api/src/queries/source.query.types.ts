import type { GitSourceStatus } from '@compartment/contracts';
import type { Database } from '../db/client';
import type { ApiDatabaseTransaction } from '../db/client.types';
import type { sourceBindings, sourceExcludedDescriptors, sources } from '../db/schema';

export type SourceStatus = GitSourceStatus;
export type SourceType = 'git';
export type SourceBindingStatus = Extract<GitSourceStatus, 'active' | 'disconnected'>;
export type SourceReadExecutor = Pick<Database, 'select'>;
export type SourceWriteExecutor = Database | ApiDatabaseTransaction;
export type SourceMutationTransaction = ApiDatabaseTransaction;
export type PersistedSourceRow = typeof sources.$inferSelect;
export type PersistedSourceBindingRow = typeof sourceBindings.$inferSelect;
export type PersistedSourceExcludedDescriptorRow = typeof sourceExcludedDescriptors.$inferSelect;

export interface SourceRow {
  automationPrincipalId: string | null;
  createdAt: Date;
  createdByPrincipalId: string;
  defaultBranchName: string;
  autoAdoptNewApps: boolean;
  defaultAutoDeployEnabled: boolean;
  defaultEnvironmentName: string;
  lastSyncAt: Date | null;
  disconnectedAt: Date | null;
  displayName: string;
  id: string;
  organizationId: string;
  providerHost: string;
  providerInstallationId: string;
  providerRegistrationId: string;
  repositoryCloneUrl: string;
  repositoryExternalId: string;
  repositoryName: string;
  repositoryOwner: string;
  status: SourceStatus;
  syncBranchName: string;
  type: SourceType;
  updatedAt: Date;
}

export interface SourceBindingRow {
  autoDeployEnabled: boolean;
  createdAt: Date;
  createdByPrincipalId: string;
  descriptorDirectory: string;
  descriptorPath: string;
  disconnectedAt: Date | null;
  id: string;
  projectId: string | null;
  projectName: string;
  sourceId: string;
  status: SourceBindingStatus;
  updatedAt: Date;
  watchPathsJson: string;
}

export interface SourceExcludedDescriptorRow {
  createdAt: Date;
  createdByPrincipalId: string;
  descriptorPath: string;
  id: string;
  sourceId: string;
  updatedAt: Date;
}

export interface SourceBindingBranchMappingRow {
  branchName: string;
  createdAt: Date;
  environmentName: string;
  id: string;
  sourceBindingId: string;
  updatedAt: Date;
}

export interface CreateSourceInput {
  automationPrincipalId?: string | null | undefined;
  createdByPrincipalId: string;
  defaultBranchName: string;
  autoAdoptNewApps: boolean;
  defaultAutoDeployEnabled: boolean;
  defaultEnvironmentName: string;
  displayName: string;
  id: string;
  lastSyncAt?: Date | null | undefined;
  organizationId: string;
  providerHost: string;
  providerInstallationId: string;
  providerRegistrationId: string;
  repositoryCloneUrl: string;
  repositoryExternalId: string;
  repositoryName: string;
  repositoryOwner: string;
  status: SourceStatus;
  syncBranchName: string;
  type: SourceType;
  updatedAt: Date;
}

export interface UpdateSourceToActiveInput {
  defaultBranchName: string;
  autoAdoptNewApps: boolean;
  defaultAutoDeployEnabled: boolean;
  defaultEnvironmentName: string;
  displayName: string;
  lastSyncAt?: Date | null | undefined;
  providerInstallationId: string;
  providerRegistrationId: string;
  repositoryCloneUrl: string;
  repositoryName: string;
  repositoryOwner: string;
  sourceId: string;
  syncBranchName: string;
  updatedAt: Date;
}

export interface UpdateSourceToDisabledInput {
  sourceId: string;
  updatedAt: Date;
}

export interface UpdateSourceAutomationPrincipalInput {
  automationPrincipalId: string;
  sourceId: string;
  updatedAt: Date;
}

export interface UpdateSourceSyncMetadataInput {
  lastSyncAt: Date;
  sourceId: string;
  updatedAt: Date;
}

export interface UpdateSourceSettingsInput {
  autoAdoptNewApps: boolean;
  sourceId: string;
  updatedAt: Date;
}

export interface CreateSourceBindingInput {
  autoDeployEnabled: boolean;
  createdByPrincipalId: string;
  descriptorDirectory: string;
  descriptorPath: string;
  id: string;
  projectId: string;
  projectName: string;
  sourceId: string;
  status: SourceBindingStatus;
  updatedAt: Date;
  watchPathsJson: string;
}

export interface UpdateSourceBindingToActiveInput {
  autoDeployEnabled: boolean;
  descriptorDirectory: string;
  descriptorPath: string;
  projectId: string;
  projectName: string;
  sourceBindingId: string;
  updatedAt: Date;
  watchPathsJson: string;
}

export interface UpdateSourceBindingWatchPathsInput {
  sourceBindingId: string;
  updatedAt: Date;
  watchPathsJson: string;
}

export interface CreateSourceBindingBranchMappingInput {
  branchName: string;
  environmentName: string;
  id: string;
  sourceBindingId: string;
  updatedAt: Date;
}

export interface CreateSourceExcludedDescriptorInput {
  createdByPrincipalId: string;
  descriptorPath: string;
  id: string;
  sourceId: string;
  updatedAt: Date;
}
