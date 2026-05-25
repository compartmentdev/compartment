import type {
  ConnectGitSourceRequest,
  GitSourceExclusionSummary,
  GitSourceLatestSyncCandidateStatus,
  GitSourceLatestSyncStatus,
  GitSourceSettings,
  GitHubProviderRegistrationStatus,
  GitSourceStatus,
} from '@compartment/contracts';
import type { Actor } from '../auth-actor.types';

export type GitHubBootstrapViewStatus = GitHubProviderRegistrationStatus;
export type GitSourceBindingViewStatus = GitSourceStatus;
export type GitSourceViewStatus = GitSourceStatus;

export interface StartGitHubProviderBootstrapInput {
  actor: Actor;
  compartmentUrl: string;
  organizationId: string;
  providerHost: string;
  repositoryOwner: string;
  returnTo?: string | undefined;
}

export interface GitSourceContextInput {
  actor: Actor;
  organizationId: string;
}

export interface ConnectGitSourceInput extends GitSourceContextInput {
  request: ConnectGitSourceRequest;
}

export interface GitSourceConnectSyncRequestView {
  descriptorPath?: string | undefined;
  requestedBranchName: string;
  taskId: string;
}

export interface ConnectGitSourceResult {
  sourceConnected: boolean;
  syncRequest: GitSourceConnectSyncRequestView | null;
  view: GitSourceView;
}

export interface DisconnectGitSourceInput extends GitSourceContextInput {
  sourceId: string;
}

export interface ReadGitSourceSettingsInput extends GitSourceContextInput {
  sourceId: string;
}

export interface UpdateGitSourceSettingsInput extends GitSourceContextInput {
  autoAdoptNewApps: boolean;
  sourceId: string;
}

export interface MutateGitSourceExclusionInput extends GitSourceContextInput {
  descriptorPath: string;
  sourceId: string;
}

export interface GitSourceRepositoryRequest {
  providerHost: string;
  repositoryName: string;
  repositoryOwner: string;
}

export interface GitSourceView {
  bindings: GitSourceBindingView[];
  source: GitSourceDetailsSummaryView;
}

export interface GitSourceListItem {
  source: GitSourceSummaryView;
}

export interface ReadGitHubProviderBootstrapStatusInput {
  actor: Actor;
  bootstrapStateId: string;
  organizationId: string;
}

export interface ReadGitHubProviderBootstrapPageInput {
  actorPrincipalId: string;
  bootstrapStateId: string;
}

export interface GitSourceBindingView {
  autoDeployEnabled: boolean;
  branchName: string;
  descriptorPath: string;
  environmentName: string;
  id: string;
  projectId: string;
  projectName: string;
  status: GitSourceBindingViewStatus;
}

export interface GitSourceLatestSyncCandidateView {
  blockedReason: string | null;
  derivedWatchPaths: string[];
  descriptorDirectory: string;
  descriptorPath: string;
  id: string;
  projectName: string | null;
  status: GitSourceLatestSyncCandidateStatus;
}

export interface GitSourceLatestSyncView {
  candidates: GitSourceLatestSyncCandidateView[];
  failureReason: string | null;
  id: string;
  requestedBranchName: string;
  resolvedCommitSha: string | null;
  status: GitSourceLatestSyncStatus;
}

export interface GitSourceSummaryView {
  defaultBranchName: string;
  displayName: string;
  id: string;
  providerHost: string;
  repositoryCloneUrl: string;
  repositoryName: string;
  repositoryOwner: string;
  status: GitSourceViewStatus;
}

export interface GitSourceDetailsSummaryView extends GitSourceSummaryView {
  autoAdoptNewApps: boolean;
  defaultAutoDeployEnabled: boolean;
  defaultEnvironmentName: string;
  exclusions: GitSourceExclusionView[];
  latestSync: GitSourceLatestSyncView | null;
}

export type GitSourceExclusionView = GitSourceExclusionSummary;
export type GitSourceSettingsView = GitSourceSettings;

export interface GitHubProviderBootstrapInstallPage {
  installUrl: string;
  kind: 'install';
}

export interface GitHubProviderBootstrapManifestPage {
  formActionUrl: string;
  kind: 'manifest';
  manifestJson: string;
  stateNonce: string;
}

export type GitHubProviderBootstrapPage = GitHubProviderBootstrapInstallPage | GitHubProviderBootstrapManifestPage;

export interface GitHubProviderBootstrapView {
  bootstrapStateId: string | null;
  browserUrl: string | null;
  installationAccountLogin: string | null;
  installationId: string | null;
  providerHost: string;
  registrationId: string;
  repositoryOwner: string;
  status: GitHubBootstrapViewStatus;
}
