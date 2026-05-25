import type { GitConnectFormInput } from './onboarding-page.types';

export function readGitRepositoryFormError(formInput: GitConnectFormInput): string | null {
  if (formInput.branchName.trim() === '') {
    return 'Branch is required.';
  }
  if (formInput.environmentName.trim() === '') {
    return 'Environment is required.';
  }
  return null;
}
