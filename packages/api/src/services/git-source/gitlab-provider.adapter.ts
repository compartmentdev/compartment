import { createGitLabTokenInvalidError } from '../../errors/api-business-error';
import type { ApiBusinessError } from '../../errors/api-business-error.shared';
import { decryptVariableValueFromStorage } from '../../lib/variables-crypto';
import type { GitProviderRegistrationRow } from '../../queries/git-provider-registration.query.types';
import { getApiConfig } from '../../runtime/runtime-access';
import type {
  CreateDescriptorPullRequestPlan,
  GitProviderAccess,
  GitProviderAdapter,
  GitProviderCredential,
  GitProviderErrorClassification,
  GitProviderRegistrationMetadata,
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
  SourceProviderHookTarget,
} from './git-source-provider.types';
import { readGitProviderWebhookSecret } from './git-source-runtime.support';
import { classifyGitProviderHttpStatus } from './git-source-provider-error.service';
import { requireGitProviderField } from './git-source-view.service';
import {
  encodeGitLabProjectPath,
  GitLabHttpClient,
  GitLabPaginationLimitError,
  readGitLabHttpStatus,
} from './gitlab-http.adapter';
import { createGitLabDescriptorMergeRequest, readGitLabMergeRequestStatus } from './gitlab-merge-request.adapter';
import { ensureGitLabProjectHook, removeGitLabProjectHooks } from './gitlab-project-hook.adapter';
import {
  assertGitLabBranch,
  gitLabEmptyRepositoryFailureMessage,
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

  public readRegistrationMetadata(registration: GitProviderRegistrationRow): GitProviderRegistrationMetadata {
    return {
      accountLogin: requireGitProviderField(registration.providerAccountLogin, 'provider_account_login'),
      expiresAt: registration.accessTokenExpiresAt,
    };
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
    await assertGitLabBranch(client(access), encodeGitLabProjectPath(ref.owner, ref.name), branch);
  }

  public async listRegistrationRepositories(access: GitProviderAccess): Promise<GitRepositorySummary[]> {
    return await listGitLabProjects(client(access));
  }

  public async readRepositoryTree(
    access: GitProviderAccess,
    ref: GitRepositoryRef,
    branch: string,
  ): Promise<GitRepositoryTreeEntry[]> {
    // Resolve the project first so an empty repository surfaces as the empty-repo
    // failure instead of a generic tree read error.
    const repository: GitRepositoryMetadata = await this.readRepositoryMetadata(access, ref);
    return await readGitLabTree(client(access), repository.repositoryExternalId, branch);
  }

  public async readRepositoryFile(
    access: GitProviderAccess,
    ref: GitRepositoryRef,
    branch: string,
    path: string,
  ): Promise<GitRepositoryFile> {
    return await readGitLabFile(client(access), encodeGitLabProjectPath(ref.owner, ref.name), branch, path);
  }

  public async createDescriptorPullRequest(
    access: GitProviderAccess,
    ref: GitRepositoryRef,
    plan: CreateDescriptorPullRequestPlan,
  ): Promise<GitPullRequestRef> {
    return await createGitLabDescriptorMergeRequest(client(access), encodeGitLabProjectPath(ref.owner, ref.name), plan);
  }

  public async readDescriptorPullRequestStatus(
    access: GitProviderAccess,
    ref: GitRepositoryRef,
    number: number,
  ): Promise<GitPullRequestStatus> {
    return await readGitLabMergeRequestStatus(client(access), encodeGitLabProjectPath(ref.owner, ref.name), number);
  }

  public async mintRuntimeAccessToken(input: MintRuntimeAccessTokenInput): Promise<string> {
    return await Promise.resolve(readGitLabRegistrationToken(input.registration));
  }

  public async onSourceConnected(
    access: GitProviderAccess,
    target: SourceProviderHookTarget,
  ): Promise<SourceProviderHookAttachment> {
    const id: string = await ensureGitLabProjectHook(
      client(access),
      target.repositoryExternalId,
      access.registration.webhookUrl,
      readGitProviderWebhookSecret(access.registration),
      target.providerWebhookId,
    );
    return { providerWebhookId: id };
  }

  public async onSourceDisconnected(access: GitProviderAccess, target: SourceProviderHookTarget): Promise<void> {
    await removeGitLabProjectHooks(
      client(access),
      target.repositoryExternalId,
      access.registration.webhookUrl,
      target.providerWebhookId,
    );
  }

  public createAuthFailureError(): ApiBusinessError {
    return createGitLabTokenInvalidError('The GitLab token is no longer valid. Re-enter the token.');
  }

  public classifyError(error: Error | undefined): GitProviderErrorClassification {
    if (error?.message === gitLabEmptyRepositoryFailureMessage) return { kind: 'empty-repo' };
    if (error instanceof GitLabPaginationLimitError) return { kind: 'unknown', userMessage: error.message };
    return classifyGitProviderHttpStatus(readGitLabHttpStatus(error));
  }
}

export const gitlabProviderAdapter: GitProviderAdapter = new GitLabProviderAdapter();

function readGitLabRegistrationToken(registration: GitProviderRegistrationRow): string {
  return decryptVariableValueFromStorage(
    requireGitProviderField(registration.accessTokenCiphertext, 'access_token_ciphertext'),
    requireGitProviderField(registration.accessTokenEncryptionKeyId, 'access_token_encryption_key_id'),
    getApiConfig().variablesMasterKey,
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
