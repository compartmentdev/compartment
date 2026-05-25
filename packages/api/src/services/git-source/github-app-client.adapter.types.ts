import type { GitDescriptorDraftFile } from '@compartment/contracts';

export interface GitHubAppManifestPlan {
  formActionUrl: string;
  manifestJson: string;
}

export interface GitHubManifestConversionResult {
  appId: string;
  appName: string | null;
  appSlug: string;
  appUrl: string | null;
  privateKeyPem: string;
  webhookSecret: string;
}

export interface GitHubRepositoryInstallation {
  installationId: string;
}

export interface GitHubAppInstallation {
  accountLogin: string;
  accountType: string;
  installationId: string;
}

export interface GitHubInstallationRepository {
  defaultBranchName: string;
  fullName: string;
  repositoryExternalId: string;
  repositoryName: string;
  repositoryOwner: string;
  private: boolean;
}

export interface GitHubRepositoryMetadata {
  defaultBranchName: string;
  repositoryCloneUrl: string;
  repositoryExternalId: string;
  repositoryName: string;
  repositoryOwner: string;
}

export interface GitHubRepositoryBranchInput {
  appId: string;
  branchName: string;
  installationId: string;
  owner: string;
  privateKeyPem: string;
  providerHost: string;
  repositoryName: string;
}

export interface GitHubRepositoryContent {
  content: string;
  sha: string;
}

export interface GitHubRepositoryTreeEntry {
  path: string;
  type: 'blob' | 'commit' | 'tree';
}

export type GitHubRepositoryPullRequestState = 'closed' | 'open';

export interface GitHubRepositoryPullRequest {
  htmlUrl: string;
  number: number;
  state: GitHubRepositoryPullRequestState;
}

export interface CreateGitHubRepositoryDescriptorPullRequestInput {
  appId: string;
  baseBranchName: string;
  descriptorPath: string;
  files: GitDescriptorDraftFile[];
  installationId: string;
  owner: string;
  privateKeyPem: string;
  projectName: string;
  providerHost: string;
  repositoryName: string;
}

export interface GitHubRepositoryPullRequestStatus {
  htmlUrl: string;
  merged: boolean;
  state: GitHubRepositoryPullRequestState;
}

export interface GitHubRepositoryPullRequestStatusInput {
  appId: string;
  installationId: string;
  owner: string;
  privateKeyPem: string;
  providerHost: string;
  pullRequestNumber: number;
  repositoryName: string;
}
