import type { GitDescriptorDraftFile, GitProviderType } from '@compartment/contracts';
import type { ApiBusinessError } from '../../errors/api-business-error.shared';
import type { GitProviderRegistrationRow } from '../../queries/git-provider-registration.query.types';
import type { SourceRow } from '../../queries/source.query.types';

/**
 * Provider kinds Compartment can integrate with. The value is persisted as
 * `git_provider_registrations.provider_type`.
 */
export type { GitProviderType } from '@compartment/contracts';

/**
 * Decrypted secret material for a single provider registration. Discriminated so
 * additional providers can carry their own secret shape without widening the GitHub
 * path. Non-secret identifiers (GitHub app/installation ids) are read from the
 * registration row at the point of use, so the credential carries only decrypted secrets.
 */
export type GitProviderCredential = GitHubAppProviderCredential | GitLabTokenProviderCredential;

interface GitHubAppProviderCredential {
  kind: 'github_app';
  privateKeyPem: string;
  token?: never;
}

interface GitLabTokenProviderCredential {
  kind: 'gitlab_token';
  privateKeyPem?: never;
  token: string;
}

/**
 * A resolved provider registration plus its decrypted credential. Domain services
 * pass this to adapter methods instead of touching provider-specific auth fields.
 */
export interface GitProviderAccess {
  credential: GitProviderCredential;
  registration: GitProviderRegistrationRow;
}

export interface GitProviderRegistrationMetadata {
  accountLogin: string;
  expiresAt: Date | null;
}

export interface GitProviderRegistrationView {
  createdAt: string;
  expiresAt: string | null;
  providerAccountLogin: string;
  providerHost: string;
  providerType: GitProviderType;
  registrationId: string;
}

export interface GitProviderRepositoryView {
  defaultBranchName: string;
  fullName: string;
  id: string;
  name: string;
  owner: string;
  private: boolean;
}

export interface GitProviderRepositoryListView {
  repositories: GitProviderRepositoryView[];
}

export type GitProviderErrorKind = 'access' | 'auth' | 'empty-repo' | 'not-found' | 'rate-limited' | 'unknown';

export interface GitProviderErrorClassification {
  kind: GitProviderErrorKind;
  userMessage?: string | undefined;
}

/** Provider-neutral repository address. `owner` is opaque and may contain slashes. */
export interface GitRepositoryRef {
  name: string;
  owner: string;
  providerHost: string;
}

export interface GitRepositoryMetadata {
  defaultBranchName: string;
  repositoryCloneUrl: string;
  repositoryExternalId: string;
  repositoryName: string;
  repositoryOwner: string;
}

export interface GitRepositorySummary {
  defaultBranchName: string;
  fullName: string;
  private: boolean;
  repositoryExternalId: string;
  repositoryName: string;
  repositoryOwner: string;
}

export interface GitRepositoryTreeEntry {
  path: string;
  type: 'blob' | 'commit' | 'tree';
}

export interface GitRepositoryFile {
  content: string;
  sha: string;
}

type GitPullRequestState = 'closed' | 'open';

export interface GitPullRequestRef {
  htmlUrl: string;
  number: number;
  state: GitPullRequestState;
}

export interface GitPullRequestStatus {
  htmlUrl: string;
  merged: boolean;
  state: GitPullRequestState;
}

/**
 * Per-repository installation resolved at connect time. Providers without an
 * installation model (only GitHub has one today) return `null`.
 */
export interface ResolvedRepositoryInstallation {
  providerInstallationId: string | null;
}

export interface CreateDescriptorPullRequestPlan {
  baseBranchName: string;
  descriptorPath: string;
  files: GitDescriptorDraftFile[];
  projectName: string;
}

export interface MintRuntimeAccessTokenInput {
  registration: GitProviderRegistrationRow;
  source: SourceRow;
}

/** Provider-side webhook a source is (or should be) attached to. */
export interface SourceProviderHookTarget {
  providerWebhookId: string | null;
  repositoryExternalId: string;
}

export interface SourceProviderHookAttachment {
  providerWebhookId: string | null;
}

/**
 * The single seam every git provider integration implements. Domain `git-source-*`
 * services depend only on this interface plus {@link getGitProviderAdapter}; nothing
 * else should reach into provider-specific adapters directly.
 */
export interface GitProviderAdapter {
  readonly providerType: GitProviderType;

  /** Decrypt the stored credential material for a registration. */
  readRegistrationCredential(registration: GitProviderRegistrationRow): GitProviderCredential;

  readRegistrationMetadata(registration: GitProviderRegistrationRow): GitProviderRegistrationMetadata;

  /** Resolve the installation that grants access to a repository at connect time. */
  resolveRepositoryInstallation(
    access: GitProviderAccess,
    ref: GitRepositoryRef,
  ): Promise<ResolvedRepositoryInstallation>;

  /** Read canonical repository metadata used to create a source row. */
  readRepositoryMetadata(
    access: GitProviderAccess,
    ref: GitRepositoryRef,
    providerInstallationId: string | null,
  ): Promise<GitRepositoryMetadata>;

  /** Throw when the branch does not exist or is not accessible. */
  assertRepositoryBranchExists(
    access: GitProviderAccess,
    ref: GitRepositoryRef,
    providerInstallationId: string | null,
    branchName: string,
  ): Promise<void>;

  /** List the repositories the registration can access. */
  listRegistrationRepositories(access: GitProviderAccess): Promise<GitRepositorySummary[]>;

  /** Read the recursive tree of a branch for descriptor discovery. */
  readRepositoryTree(
    access: GitProviderAccess,
    ref: GitRepositoryRef,
    branchName: string,
  ): Promise<GitRepositoryTreeEntry[]>;

  /** Read a single file's decoded contents at a branch. */
  readRepositoryFile(
    access: GitProviderAccess,
    ref: GitRepositoryRef,
    branchName: string,
    path: string,
  ): Promise<GitRepositoryFile>;

  /** Open a descriptor pull/merge request adding the given files. */
  createDescriptorPullRequest(
    access: GitProviderAccess,
    ref: GitRepositoryRef,
    plan: CreateDescriptorPullRequestPlan,
  ): Promise<GitPullRequestRef>;

  /** Read the current state of a previously created descriptor pull/merge request. */
  readDescriptorPullRequestStatus(
    access: GitProviderAccess,
    ref: GitRepositoryRef,
    pullRequestNumber: number,
  ): Promise<GitPullRequestStatus>;

  /**
   * Mint the bearer token the worker uses to fetch source for a deploy. GitHub mints
   * a short-lived installation token; GitLab returns the stored access token.
   */
  mintRuntimeAccessToken(input: MintRuntimeAccessTokenInput): Promise<string>;

  /** Attach the provider-side webhook for a repository being connected as a source. */
  onSourceConnected(access: GitProviderAccess, target: SourceProviderHookTarget): Promise<SourceProviderHookAttachment>;

  /** Remove the provider-side webhook for a source; failures are surfaced. */
  onSourceDisconnected(access: GitProviderAccess, target: SourceProviderHookTarget): Promise<void>;

  createAuthFailureError(): ApiBusinessError;

  classifyError(error: Error | undefined): GitProviderErrorClassification;
}
