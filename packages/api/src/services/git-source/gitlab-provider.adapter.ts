import { decryptVariableValueFromStorage } from '../../lib/variables-crypto';
import type { GitProviderRegistrationRow } from '../../queries/git-provider-registration.query.types';
import type { SourceRow } from '../../queries/source.query.types';
import { getApiConfig } from '../../runtime/runtime-access';
import type {
  CreateDescriptorPullRequestPlan,
  GitProviderAccess,
  GitProviderAdapter,
  GitProviderCredential,
  GitPullRequestRef,
  GitPullRequestStatus,
  GitRepositoryFile,
  GitRepositoryMetadata,
  GitRepositoryRef,
  GitRepositorySummary,
  GitRepositoryTreeEntry,
  MintRuntimeAccessTokenInput,
  ResolvedRepositoryInstallation,
} from './git-source-provider.types';
import { requireGitProviderField } from './git-source-view.service';
import {
  isGitLabAuthenticationFailure,
  isGitLabRepositoryAccessFailure,
  GitLabHttpClient,
} from './gitlab-http.adapter';
import { createGitLabDescriptorMergeRequest, readGitLabMergeRequestStatus } from './gitlab-merge-request.adapter';
import { createGitLabProjectHook, deleteGitLabProjectHook } from './gitlab-project-hook.adapter';
import {
  assertGitLabBranch,
  listGitLabProjects,
  readGitLabFile,
  readGitLabProject,
  readGitLabTree,
  toGitRepositoryMetadata,
} from './gitlab-repository.adapter';

class GitLabProviderAdapter implements GitProviderAdapter {
  public readonly providerType: 'gitlab' = 'gitlab';

  public readRegistrationCredential(registration: GitProviderRegistrationRow): GitProviderCredential {
    return { kind: 'gitlab_token', token: readGitLabRegistrationToken(registration) };
  }

  public async resolveRepositoryInstallation(): Promise<ResolvedRepositoryInstallation> {
    return await Promise.resolve({ providerInstallationId: null });
  }

  public async readRepositoryMetadata(
    access: GitProviderAccess,
    ref: GitRepositoryRef,
  ): Promise<GitRepositoryMetadata> {
    return toGitRepositoryMetadata(await readGitLabProject(client(access), ref.owner, ref.name));
  }

  public async assertRepositoryBranchExists(
    access: GitProviderAccess,
    ref: GitRepositoryRef,
    _installationId: string | null,
    branch: string,
  ): Promise<void> {
    const repository: GitRepositoryMetadata = await this.readRepositoryMetadata(access, ref);
    await assertGitLabBranch(client(access), repository.repositoryExternalId, branch);
  }

  public async listRegistrationRepositories(access: GitProviderAccess): Promise<GitRepositorySummary[]> {
    return await listGitLabProjects(client(access));
  }

  public async readRepositoryTree(
    access: GitProviderAccess,
    ref: GitRepositoryRef,
    branch: string,
  ): Promise<GitRepositoryTreeEntry[]> {
    const repository: GitRepositoryMetadata = await this.readRepositoryMetadata(access, ref);
    return await readGitLabTree(client(access), repository.repositoryExternalId, branch);
  }

  public async readRepositoryFile(
    access: GitProviderAccess,
    ref: GitRepositoryRef,
    branch: string,
    path: string,
  ): Promise<GitRepositoryFile> {
    const repository: GitRepositoryMetadata = await this.readRepositoryMetadata(access, ref);
    return await readGitLabFile(client(access), repository.repositoryExternalId, branch, path);
  }

  public async createDescriptorPullRequest(
    access: GitProviderAccess,
    ref: GitRepositoryRef,
    plan: CreateDescriptorPullRequestPlan,
  ): Promise<GitPullRequestRef> {
    const repository: GitRepositoryMetadata = await this.readRepositoryMetadata(access, ref);
    return await createGitLabDescriptorMergeRequest(client(access), repository.repositoryExternalId, plan);
  }

  public async readDescriptorPullRequestStatus(
    access: GitProviderAccess,
    ref: GitRepositoryRef,
    number: number,
  ): Promise<GitPullRequestStatus> {
    const repository: GitRepositoryMetadata = await this.readRepositoryMetadata(access, ref);
    return await readGitLabMergeRequestStatus(client(access), repository.repositoryExternalId, number);
  }

  public async mintRuntimeAccessToken(input: MintRuntimeAccessTokenInput): Promise<string> {
    return await Promise.resolve(readGitLabRegistrationToken(input.registration));
  }

  public async onSourceConnected(
    access: GitProviderAccess,
    source: SourceRow,
  ): Promise<{ providerWebhookId: string | null }> {
    const id: string = await createGitLabProjectHook(
      client(access),
      source.repositoryExternalId,
      access.registration.webhookUrl,
      readWebhookSecret(access.registration),
    );
    return { providerWebhookId: id };
  }

  public async onSourceDisconnected(access: GitProviderAccess, source: SourceRow): Promise<void> {
    if (source.providerWebhookId != null)
      await deleteGitLabProjectHook(client(access), source.repositoryExternalId, source.providerWebhookId);
  }

  public isRepositoryAccessFailure(error: Error | undefined): boolean {
    return isGitLabRepositoryAccessFailure(error);
  }
  public isRepositoryEmptyFailure(error: Error | undefined): boolean {
    return error?.message === 'Git Repository is empty';
  }
  public isAuthenticationFailure(error: Error | undefined): boolean {
    return isGitLabAuthenticationFailure(error);
  }
}

export const gitlabProviderAdapter: GitProviderAdapter = new GitLabProviderAdapter();

function readGitLabRegistrationToken(registration: GitProviderRegistrationRow): string {
  return decryptRegistrationField(
    registration.accessTokenCiphertext ?? null,
    registration.accessTokenEncryptionKeyId ?? null,
    'access token',
  );
}

function client(access: GitProviderAccess): GitLabHttpClient {
  return new GitLabHttpClient({
    providerHost: access.registration.providerHost,
    token: requireGitLabTokenCredential(access.credential).token,
  });
}

function requireGitLabTokenCredential(
  credential: GitProviderCredential,
): Extract<GitProviderCredential, { kind: 'gitlab_token' }> {
  if (credential.kind !== 'gitlab_token')
    throw new Error('GitLab provider operation requires a GitLab token credential.');
  return credential;
}

function readWebhookSecret(registration: GitProviderRegistrationRow): string {
  return decryptRegistrationField(
    registration.webhookSecretCiphertext,
    registration.webhookSecretEncryptionKeyId,
    'webhook secret',
  );
}

function decryptRegistrationField(ciphertext: string | null, keyId: string | null, name: string): string {
  return decryptVariableValueFromStorage(
    requireGitProviderField(ciphertext, `${name}_ciphertext`),
    requireGitProviderField(keyId, `${name}_encryption_key_id`),
    getApiConfig().variablesMasterKey,
  );
}
