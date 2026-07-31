import type {
  GitProviderRegistrationRepositoryListResponse,
  GitProviderRepositorySummary,
} from '@compartment/contracts/browser';
import { listBrowserGitProviderRepositories } from './onboarding-git-api';
import type { OnboardingRepositoryOption } from './onboarding-page.types';

export async function loadGitLabRepositoryOptions(
  selectedOrganizationSlug: string,
  registrationId: string,
  providerHost: string,
): Promise<OnboardingRepositoryOption[]> {
  const response: GitProviderRegistrationRepositoryListResponse = await listBrowserGitProviderRepositories(
    selectedOrganizationSlug,
    registrationId,
  );
  return response.repositories.map(
    (repository: GitProviderRepositorySummary): OnboardingRepositoryOption => ({
      defaultBranchName: repository.defaultBranchName,
      id: repository.id,
      name: repository.name,
      owner: repository.owner,
      provider: 'gitlab',
      providerHost,
      registrationId,
    }),
  );
}
