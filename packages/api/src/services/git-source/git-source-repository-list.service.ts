import {
  type GitHubInstallationRepositoryListResponse,
  type GitHubInstallationRepositorySummary,
} from '@compartment/contracts';
import { createGitSourceRequestInvalidError } from '../../errors/api-business-error';
import { requireGitProviderRegistrationAccess } from './git-source-descriptor-registration-access.service';
import { getGitProviderAdapter } from './git-source-provider.registry';
import type { GitProviderAccess, GitProviderAdapter, GitRepositorySummary } from './git-source-provider.types';
import type { GitSourceContextInput } from './git-source.service.types';

export interface ListGitHubInstallationRepositoriesInput extends GitSourceContextInput {
  providerHost: string;
  registrationId: string;
  repositoryOwner: string;
}

export async function listGitHubInstallationRepositories(
  input: ListGitHubInstallationRepositoriesInput,
): Promise<GitHubInstallationRepositoryListResponse> {
  const access: GitProviderAccess = await requireGitProviderRegistrationAccess(input);
  if (access.registration.providerType !== 'github_app') {
    throw createGitSourceRequestInvalidError('The selected registration is not a GitHub App registration.');
  }
  const adapter: GitProviderAdapter = getGitProviderAdapter(access.registration.providerType);
  try {
    return buildReadyRegistrationRepositoriesResponse(await adapter.listRegistrationRepositories(access));
  } catch (error) {
    return recoverRegistrationRepositories(adapter, error instanceof Error ? error : undefined);
  }
}

function buildReadyRegistrationRepositoriesResponse(
  repositories: GitRepositorySummary[],
): GitHubInstallationRepositoryListResponse {
  return {
    repositories: repositories.map(toInstallationRepositorySummary),
    status: 'ready',
  };
}

function recoverRegistrationRepositories(
  adapter: GitProviderAdapter,
  error: Error | undefined,
): GitHubInstallationRepositoryListResponse {
  if (adapter.isRepositoryAccessFailure(error) || adapter.isAuthenticationFailure(error)) {
    return {
      repositories: [],
      status: 'provider_bootstrap_required',
    };
  }

  throw error ?? new Error('Git repository list failed.');
}

function toInstallationRepositorySummary(repository: GitRepositorySummary): GitHubInstallationRepositorySummary {
  return {
    defaultBranchName: repository.defaultBranchName,
    fullName: repository.fullName,
    id: repository.repositoryExternalId,
    name: repository.repositoryName,
    owner: repository.repositoryOwner,
    private: repository.private,
  };
}
