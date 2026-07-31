import { createGitSourceRegistrationFailedError } from '../../errors/api-business-error';
import type { ApiBusinessError } from '../../errors/api-business-error.shared';
import type { GitProviderReadExecutor } from '../../queries/git-provider-registration.query.types';
import {
  assertGitHubRepositoryBranchExists,
  createGitHubRepositoryDescriptorPullRequest,
  listGitHubInstallationRepositories,
  readGitHubRepositoryContent,
  readGitHubRepositoryMetadata,
  readGitHubRepositoryPullRequestStatus,
  readGitHubRepositoryTree,
  resolveGitHubRepositoryInstallation,
} from './github-app-client.adapter';
import type { GitHubInstallationRepository } from './github-app-client.adapter.types';
import {
  isGitHubRepositoryEmptyFailure,
  mintGitHubInstallationToken,
  readGitHubRequestFailureStatus,
} from './github-app-http.adapter';
import { classifyGitProviderHttpStatus } from './git-source-provider-error.service';
import type {
  CreateDescriptorPullRequestPlan,
  GitProviderAccess,
  GitProviderAdapter,
  GitProviderCredential,
  GitProviderErrorClassification,
  GitProviderRegistrationMetadata,
  GitProviderType,
  GitPullRequestRef,
  GitPullRequestStatus,
  GitRepositoryFile,
  GitRepositoryMetadata,
  GitRepositoryRef,
  GitRepositorySummary,
  GitRepositoryTreeEntry,
  MintRuntimeAccessTokenInput,
  ResolvedRepositoryInstallation,
  SourceProviderHookAttachment,
} from './git-source-provider.types';
import { readGitHubAppProviderCredential } from './github-provider-credential.adapter';

class GitHubProviderAdapter implements GitProviderAdapter {
  public readonly providerType: GitProviderType = 'github_app';

  public async readRegistrationCredential(
    executor: GitProviderReadExecutor,
    registrationId: string,
  ): Promise<GitProviderCredential> {
    return await readGitHubAppProviderCredential(executor, registrationId);
  }

  public readRegistrationMetadata(access: GitProviderAccess): GitProviderRegistrationMetadata {
    return {
      accountLogin: requireGitHubAppCredential(access.credential).installationAccountLogin,
      expiresAt: null,
    };
  }

  public async resolveRepositoryInstallation(
    access: GitProviderAccess,
    ref: GitRepositoryRef,
  ): Promise<ResolvedRepositoryInstallation> {
    const installation: { installationId: string } = await resolveGitHubRepositoryInstallation({
      appId: requireGitHubAppCredential(access.credential).appId,
      owner: ref.owner,
      privateKeyPem: requireGitHubAppCredential(access.credential).privateKeyPem,
      providerHost: ref.providerHost,
      repositoryName: ref.name,
    });

    return { providerInstallationId: installation.installationId };
  }

  public async readRepositoryMetadata(
    access: GitProviderAccess,
    ref: GitRepositoryRef,
    providerInstallationId: string | null,
  ): Promise<GitRepositoryMetadata> {
    return await readGitHubRepositoryMetadata({
      appId: requireGitHubAppCredential(access.credential).appId,
      installationId: requireResolvedInstallationId(providerInstallationId),
      owner: ref.owner,
      privateKeyPem: requireGitHubAppCredential(access.credential).privateKeyPem,
      providerHost: ref.providerHost,
      repositoryName: ref.name,
    });
  }

  public async assertRepositoryBranchExists(
    access: GitProviderAccess,
    ref: GitRepositoryRef,
    providerInstallationId: string | null,
    branchName: string,
  ): Promise<void> {
    await assertGitHubRepositoryBranchExists({
      appId: requireGitHubAppCredential(access.credential).appId,
      branchName,
      installationId: requireResolvedInstallationId(providerInstallationId),
      owner: ref.owner,
      privateKeyPem: requireGitHubAppCredential(access.credential).privateKeyPem,
      providerHost: ref.providerHost,
      repositoryName: ref.name,
    });
  }

  public async listRegistrationRepositories(access: GitProviderAccess): Promise<GitRepositorySummary[]> {
    const repositories: GitHubInstallationRepository[] = await listGitHubInstallationRepositories({
      appId: requireGitHubAppCredential(access.credential).appId,
      installationId: requireGitHubAppCredential(access.credential).installationId,
      privateKeyPem: requireGitHubAppCredential(access.credential).privateKeyPem,
      providerHost: access.registration.providerHost,
    });

    return repositories.map(toGitRepositorySummary);
  }

  public async readRepositoryTree(
    access: GitProviderAccess,
    ref: GitRepositoryRef,
    branchName: string,
  ): Promise<GitRepositoryTreeEntry[]> {
    return await readGitHubRepositoryTree({
      appId: requireGitHubAppCredential(access.credential).appId,
      branchName,
      installationId: requireGitHubAppCredential(access.credential).installationId,
      owner: ref.owner,
      privateKeyPem: requireGitHubAppCredential(access.credential).privateKeyPem,
      providerHost: ref.providerHost,
      repositoryName: ref.name,
    });
  }

  public async readRepositoryFile(
    access: GitProviderAccess,
    ref: GitRepositoryRef,
    branchName: string,
    path: string,
  ): Promise<GitRepositoryFile> {
    return await readGitHubRepositoryContent({
      appId: requireGitHubAppCredential(access.credential).appId,
      branchName,
      installationId: requireGitHubAppCredential(access.credential).installationId,
      owner: ref.owner,
      path,
      privateKeyPem: requireGitHubAppCredential(access.credential).privateKeyPem,
      providerHost: ref.providerHost,
      repositoryName: ref.name,
    });
  }

  public async createDescriptorPullRequest(
    access: GitProviderAccess,
    ref: GitRepositoryRef,
    plan: CreateDescriptorPullRequestPlan,
  ): Promise<GitPullRequestRef> {
    return await createGitHubRepositoryDescriptorPullRequest({
      appId: requireGitHubAppCredential(access.credential).appId,
      baseBranchName: plan.baseBranchName,
      descriptorPath: plan.descriptorPath,
      files: plan.files,
      installationId: requireGitHubAppCredential(access.credential).installationId,
      owner: ref.owner,
      privateKeyPem: requireGitHubAppCredential(access.credential).privateKeyPem,
      projectName: plan.projectName,
      providerHost: ref.providerHost,
      repositoryName: ref.name,
    });
  }

  public async readDescriptorPullRequestStatus(
    access: GitProviderAccess,
    ref: GitRepositoryRef,
    pullRequestNumber: number,
  ): Promise<GitPullRequestStatus> {
    return await readGitHubRepositoryPullRequestStatus({
      appId: requireGitHubAppCredential(access.credential).appId,
      installationId: requireGitHubAppCredential(access.credential).installationId,
      owner: ref.owner,
      privateKeyPem: requireGitHubAppCredential(access.credential).privateKeyPem,
      providerHost: ref.providerHost,
      pullRequestNumber,
      repositoryName: ref.name,
    });
  }

  public async mintRuntimeAccessToken(input: MintRuntimeAccessTokenInput): Promise<string> {
    const credential: Extract<GitProviderCredential, { kind: 'github_app' }> = requireGitHubAppCredential(
      input.access.credential,
    );
    return await mintGitHubInstallationToken({
      appId: credential.appId,
      installationId: requireResolvedInstallationId(input.source.providerInstallationId),
      privateKeyPem: credential.privateKeyPem,
      providerHost: input.source.providerHost,
    });
  }

  public async onSourceConnected(): Promise<SourceProviderHookAttachment> {
    return await Promise.resolve({ providerWebhookId: null });
  }

  public async onSourceDisconnected(): Promise<void> {
    return await Promise.resolve();
  }

  public createAuthFailureError(): ApiBusinessError {
    return createGitSourceRegistrationFailedError(
      'Git provider credentials are no longer valid. Reconnect the provider.',
    );
  }

  public classifyError(error: Error | undefined): GitProviderErrorClassification {
    if (isGitHubRepositoryEmptyFailure(error)) return { kind: 'empty-repo' };
    return classifyGitProviderHttpStatus(readGitHubRequestFailureStatus(error));
  }
}

function requireGitHubAppCredential(
  credential: GitProviderCredential,
): Extract<GitProviderCredential, { kind: 'github_app' }> {
  if (credential.kind !== 'github_app') {
    throw new Error('GitHub provider operation requires a GitHub App credential.');
  }

  return credential;
}

export const githubProviderAdapter: GitProviderAdapter = new GitHubProviderAdapter();

function toGitRepositorySummary(repository: GitHubInstallationRepository): GitRepositorySummary {
  return {
    defaultBranchName: repository.defaultBranchName,
    fullName: repository.fullName,
    private: repository.private,
    repositoryExternalId: repository.repositoryExternalId,
    repositoryName: repository.repositoryName,
    repositoryOwner: repository.repositoryOwner,
  };
}

function requireResolvedInstallationId(providerInstallationId: string | null): string {
  if (providerInstallationId === null) {
    throw new Error('GitHub repository operation requires a resolved installation id.');
  }

  return providerInstallationId;
}
