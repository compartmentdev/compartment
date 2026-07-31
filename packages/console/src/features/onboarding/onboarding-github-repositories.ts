import type {
  GitProviderRegistrationRepositoryListResponse,
  GitProviderRepositorySummary,
} from '@compartment/contracts/browser';
import { listBrowserGitProviderRepositories } from './onboarding-git-api';
import type { OnboardingRepositoryOption } from './onboarding-page.types';
import type { OnboardingRepositoryLoadInput } from './onboarding-git-provider.types';

export async function loadGitHubRepositoryOptions(
  input: OnboardingRepositoryLoadInput,
): Promise<OnboardingRepositoryOption[]> {
  const response: GitProviderRegistrationRepositoryListResponse = await listBrowserGitProviderRepositories(
    input.selectedOrganizationSlug,
    input.registrationId,
  );
  return response.repositories.map(
    (repository: GitProviderRepositorySummary): OnboardingRepositoryOption => ({
      defaultBranchName: repository.defaultBranchName,
      id: repository.id,
      name: repository.name,
      owner: repository.owner,
      provider: 'github',
      providerHost: input.providerHost,
      registrationId: input.registrationId,
    }),
  );
}
