import { loadGitHubRepositoryOptions } from './onboarding-github-repositories';
import { loadGitLabRepositoryOptions } from './onboarding-gitlab-repositories';
import type { OnboardingGitProviderDescriptor, OnboardingRepositoryLoadInput } from './onboarding-git-provider.types';
import type { OnboardingGitProvider, OnboardingRepositoryOption } from './onboarding-page.types';

const descriptors: Record<OnboardingGitProvider, OnboardingGitProviderDescriptor> = {
  github: {
    connectMode: 'app',
    defaultHost: 'github.com',
    loadRepositories: loadGitHubRepositoryOptions,
    provider: 'github',
    repositoryLoadFailure: 'GitHub installation cannot be read. Reconnect GitHub.',
    repositorySourceName: 'GitHub installation',
    request: { label: 'Pull request', name: 'pull request', shortName: 'PR' },
  },
  gitlab: {
    connectMode: 'token',
    defaultHost: 'gitlab.com',
    loadRepositories: async (input: OnboardingRepositoryLoadInput): Promise<OnboardingRepositoryOption[]> =>
      await loadGitLabRepositoryOptions(input.selectedOrganizationSlug, input.registrationId, input.providerHost),
    provider: 'gitlab',
    repositoryLoadFailure: 'GitLab repositories cannot be read. Try again.',
    repositorySourceName: 'GitLab registration',
    request: { label: 'Merge request', name: 'merge request', shortName: 'MR' },
  },
};

export function readOnboardingGitProviderDescriptor(provider: OnboardingGitProvider): OnboardingGitProviderDescriptor {
  return descriptors[provider];
}

export function readDefaultOnboardingGitProviderDescriptor(): OnboardingGitProviderDescriptor {
  return descriptors.github;
}
