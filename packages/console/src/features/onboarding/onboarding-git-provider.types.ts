import type { OnboardingGitProvider, OnboardingRepositoryOption } from './onboarding-page.types';

export interface OnboardingRepositoryLoadInput {
  providerHost: string;
  registrationId: string;
  selectedOrganizationSlug: string;
}

export interface OnboardingGitRequestTerms {
  label: string;
  name: string;
  shortName: string;
}

export interface OnboardingGitProviderDescriptor {
  connectMode: 'app' | 'token';
  defaultHost: string;
  loadRepositories: (input: OnboardingRepositoryLoadInput) => Promise<OnboardingRepositoryOption[]>;
  provider: OnboardingGitProvider;
  repositoryLoadFailure: string;
  repositorySourceName: string;
  request: OnboardingGitRequestTerms;
}
