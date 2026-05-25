import {
  type GitHubInstallationRepositoryListResponse,
  type GitHubInstallationRepositorySummary,
} from '@compartment/contracts';
import { listGitHubInstallationRepositories as listGitHubInstallationRepositoriesFromGitHub } from './github-app-client.adapter';
import type { GitHubInstallationRepository } from './github-app-client.adapter.types';
import { isGitHubAppAuthenticationFailure, isGitHubRepositoryAccessFailure } from './github-app-http.adapter';
import {
  buildGitHubRegistrationClientAuth,
  requireGitHubRegistrationAccess,
  type GitHubRegistrationAccess,
} from './git-source-descriptor-registration-access.service';
import type { GitSourceContextInput } from './git-source.service.types';

export interface ListGitHubInstallationRepositoriesInput extends GitSourceContextInput {
  providerHost: string;
  registrationId: string;
  repositoryOwner: string;
}

export async function listGitHubInstallationRepositories(
  input: ListGitHubInstallationRepositoriesInput,
): Promise<GitHubInstallationRepositoryListResponse> {
  const access: GitHubRegistrationAccess = await requireGitHubRegistrationAccess(input);
  try {
    return buildReadyGitHubInstallationRepositoriesResponse(
      await listGitHubInstallationRepositoriesFromGitHub({
        ...buildGitHubRegistrationClientAuth(access),
      }),
    );
  } catch (error) {
    return recoverGitHubInstallationRepositories(error instanceof Error ? error : undefined);
  }
}

function buildReadyGitHubInstallationRepositoriesResponse(
  repositories: GitHubInstallationRepository[],
): GitHubInstallationRepositoryListResponse {
  return {
    repositories: repositories.map(toGitHubInstallationRepositorySummary),
    status: 'ready',
  };
}

function recoverGitHubInstallationRepositories(error: Error | undefined): GitHubInstallationRepositoryListResponse {
  if (!isGitHubProviderRecoveryFailure(error)) {
    throw error ?? new Error('GitHub repository list failed.');
  }

  return buildProviderBootstrapRequiredGitHubInstallationRepositoriesResponse();
}

function isGitHubProviderRecoveryFailure(error: Error | undefined): boolean {
  return isGitHubRepositoryAccessFailure(error) || isGitHubAppAuthenticationFailure(error);
}

function buildProviderBootstrapRequiredGitHubInstallationRepositoriesResponse(): GitHubInstallationRepositoryListResponse {
  return {
    repositories: [],
    status: 'provider_bootstrap_required',
  };
}

function toGitHubInstallationRepositorySummary(
  repository: GitHubInstallationRepository,
): GitHubInstallationRepositorySummary {
  return {
    defaultBranchName: repository.defaultBranchName,
    fullName: repository.fullName,
    id: repository.repositoryExternalId,
    name: repository.repositoryName,
    owner: repository.repositoryOwner,
    private: repository.private,
  };
}
