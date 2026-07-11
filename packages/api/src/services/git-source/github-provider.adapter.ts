import { decryptVariableValueFromStorage } from '../../lib/variables-crypto';
import type { GitProviderRegistrationRow } from '../../queries/git-provider-registration.query.types';
import { getApiConfig } from '../../runtime/runtime-access';
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
  isGitHubAppAuthenticationFailure,
  isGitHubRepositoryAccessFailure,
  isGitHubRepositoryEmptyFailure,
  mintGitHubInstallationToken,
} from './github-app-http.adapter';
import { requireEncryptedRegistrationField } from './git-source-resolution-worker.support';
import type {
  CreateDescriptorPullRequestPlan,
  GitProviderAccess,
  GitProviderAdapter,
  GitProviderCredential,
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
import { requireGitProviderField } from './git-source-view.service';

class GitHubProviderAdapter implements GitProviderAdapter {
  public readonly providerType: GitProviderType = 'github_app';

  public readRegistrationCredential(registration: GitProviderRegistrationRow): GitProviderCredential {
    return {
      kind: 'github_app',
      privateKeyPem: readGitHubRegistrationPrivateKey(registration),
    };
  }

  public async resolveRepositoryInstallation(
    access: GitProviderAccess,
    ref: GitRepositoryRef,
  ): Promise<ResolvedRepositoryInstallation> {
    const installation: { installationId: string } = await resolveGitHubRepositoryInstallation({
      appId: requireRegistrationAppId(access.registration),
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
      appId: requireRegistrationAppId(access.registration),
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
      appId: requireRegistrationAppId(access.registration),
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
      appId: requireRegistrationAppId(access.registration),
      installationId: requireRegistrationInstallationId(access.registration),
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
      appId: requireRegistrationAppId(access.registration),
      branchName,
      installationId: requireRegistrationInstallationId(access.registration),
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
      appId: requireRegistrationAppId(access.registration),
      branchName,
      installationId: requireRegistrationInstallationId(access.registration),
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
      appId: requireRegistrationAppId(access.registration),
      baseBranchName: plan.baseBranchName,
      descriptorPath: plan.descriptorPath,
      files: plan.files,
      installationId: requireRegistrationInstallationId(access.registration),
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
      appId: requireRegistrationAppId(access.registration),
      installationId: requireRegistrationInstallationId(access.registration),
      owner: ref.owner,
      privateKeyPem: requireGitHubAppCredential(access.credential).privateKeyPem,
      providerHost: ref.providerHost,
      pullRequestNumber,
      repositoryName: ref.name,
    });
  }

  public async mintRuntimeAccessToken(input: MintRuntimeAccessTokenInput): Promise<string> {
    return await mintGitHubInstallationToken({
      appId: requireEncryptedRegistrationField(input.registration.appId, 'app_id'),
      installationId: requireResolvedInstallationId(input.source.providerInstallationId),
      privateKeyPem: decryptEncryptedRegistrationPrivateKey(input.registration),
      providerHost: input.source.providerHost,
    });
  }

  public async onSourceConnected(): Promise<SourceProviderHookAttachment> {
    return await Promise.resolve({ providerWebhookId: null });
  }

  public async onSourceDisconnected(): Promise<void> {
    return await Promise.resolve();
  }

  public isRepositoryAccessFailure(error: Error | undefined): boolean {
    return isGitHubRepositoryAccessFailure(error);
  }

  public isRepositoryEmptyFailure(error: Error | undefined): boolean {
    return isGitHubRepositoryEmptyFailure(error);
  }

  public isAuthenticationFailure(error: Error | undefined): boolean {
    return isGitHubAppAuthenticationFailure(error);
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

// Interactive/connect paths decrypt via `requireGitProviderField` (rejects empty strings, matching the
// original descriptor/connect behavior). The worker mint path below uses `requireEncryptedRegistrationField`
// (rejects only null) to preserve the worker's original distinct error messages. Keep both as-is.
export function readGitHubRegistrationPrivateKey(registration: GitProviderRegistrationRow): string {
  return decryptVariableValueFromStorage(
    requireGitProviderField(registration.privateKeyPemCiphertext, 'private_key_pem_ciphertext'),
    requireGitProviderField(registration.privateKeyPemEncryptionKeyId, 'private_key_pem_encryption_key_id'),
    getApiConfig().variablesMasterKey,
  );
}

function decryptEncryptedRegistrationPrivateKey(registration: GitProviderRegistrationRow): string {
  return decryptVariableValueFromStorage(
    requireEncryptedRegistrationField(registration.privateKeyPemCiphertext, 'private_key_pem_ciphertext'),
    requireEncryptedRegistrationField(registration.privateKeyPemEncryptionKeyId, 'private_key_pem_encryption_key_id'),
    getApiConfig().variablesMasterKey,
  );
}

function requireRegistrationAppId(registration: GitProviderRegistrationRow): string {
  return requireGitProviderField(registration.appId, 'app_id');
}

function requireRegistrationInstallationId(registration: GitProviderRegistrationRow): string {
  return requireGitProviderField(registration.installationId, 'installation_id');
}

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
