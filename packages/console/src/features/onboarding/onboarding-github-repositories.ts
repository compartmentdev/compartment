import type {
  GitHubInstallationRepositoryListResponse,
  GitHubInstallationRepositorySummary,
  GitHubProviderBootstrapResponse,
} from '@compartment/contracts/browser';
import { listBrowserGitHubInstallationRepositories, startBrowserGitHubProviderBootstrap } from './onboarding-git-api';
import { buildGitHubBootstrapReturnPath } from './onboarding-git-connect-actions';
import { gitOnboardingProviderHost } from './onboarding-git-constants';
import type { OnboardingRepositoryOption } from './onboarding-page.types';

type GitHubRepositoryOptionsResult =
  | { kind: 'ready'; repositories: OnboardingRepositoryOption[] }
  | { kind: 'redirecting' };

export async function loadGitHubRepositoryOptions(input: {
  registrationId: string;
  repositoryOwner: string;
  selectedOrganizationSlug: string;
  sessionId: string | undefined;
}): Promise<GitHubRepositoryOptionsResult> {
  const response: GitHubInstallationRepositoryListResponse = await listBrowserGitHubInstallationRepositories(
    input.selectedOrganizationSlug,
    input.registrationId,
    { providerHost: gitOnboardingProviderHost, repositoryOwner: input.repositoryOwner },
  );
  if (response.status === 'provider_bootstrap_required') {
    await redirectToGitHubProviderBootstrap(input);
    return { kind: 'redirecting' };
  }
  return {
    kind: 'ready',
    repositories: response.repositories.map(
      (repository: GitHubInstallationRepositorySummary): OnboardingRepositoryOption =>
        toGitHubRepositoryOption(repository, input.registrationId),
    ),
  };
}

function toGitHubRepositoryOption(
  repository: GitHubInstallationRepositorySummary,
  registrationId: string,
): OnboardingRepositoryOption {
  return {
    defaultBranchName: repository.defaultBranchName,
    id: repository.id,
    name: repository.name,
    owner: repository.owner,
    provider: 'github',
    providerHost: gitOnboardingProviderHost,
    registrationId,
  };
}

async function redirectToGitHubProviderBootstrap(input: {
  repositoryOwner: string;
  selectedOrganizationSlug: string;
  sessionId: string | undefined;
}): Promise<void> {
  const returnTo: string | undefined =
    input.sessionId === undefined
      ? undefined
      : buildGitHubBootstrapReturnPath(input.sessionId, undefined, input.repositoryOwner);
  const bootstrap: GitHubProviderBootstrapResponse = await startBrowserGitHubProviderBootstrap(
    input.selectedOrganizationSlug,
    { providerHost: gitOnboardingProviderHost, repositoryOwner: input.repositoryOwner, returnTo },
  );
  if (bootstrap.browserUrl === null) throw new Error('GitHub provider bootstrap did not return a browser URL.');
  window.location.assign(bootstrap.browserUrl);
}
