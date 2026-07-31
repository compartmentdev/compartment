import { describe, expect, it } from 'vitest';
import { readInitialGitFormInput } from '../src/features/onboarding/onboarding-git-repository-form-input';
import type { OnboardingRepositoryOption } from '../src/features/onboarding/onboarding-page.types';

describe('Git repository form input', (): void => {
  it('does not fall back to another repository when the selected repository disappears', (): void => {
    const repository: OnboardingRepositoryOption = {
      defaultBranchName: 'main',
      id: 'repo_other',
      name: 'other',
      owner: 'acme',
      provider: 'gitlab',
      providerHost: 'gitlab.com',
      registrationId: 'gpr_new',
    };
    expect(
      readInitialGitFormInput([repository], null, {
        initialBranchName: undefined,
        initialEnvironmentName: undefined,
        selectedRepositoryId: 'repo_missing',
      }),
    ).toBeNull();
  });
});
