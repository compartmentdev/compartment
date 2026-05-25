import { defaultCompartmentEnvironmentName } from '@compartment/contracts/browser';
import type { GitConnectFormInput, OnboardingRepositoryOption } from './onboarding-page.types';

interface InitialGitFormInputOptions {
  initialBranchName: string | undefined;
  initialEnvironmentName: string | undefined;
  selectedRepositoryId: string | undefined;
}

export function readInitialGitFormInput(
  repositoryOptions: OnboardingRepositoryOption[],
  current: GitConnectFormInput | null,
  input: Readonly<InitialGitFormInputOptions>,
): GitConnectFormInput | null {
  const selectedRepository: OnboardingRepositoryOption | undefined = readRepositoryOption(repositoryOptions, input);
  if (selectedRepository !== undefined) {
    return readGitFormInputForRepository(selectedRepository, current, input);
  }
  const currentRepository: OnboardingRepositoryOption | undefined = readCurrentRepositoryOption(
    repositoryOptions,
    current,
  );
  if (current !== null && currentRepository !== undefined) {
    return { ...current, repository: currentRepository };
  }
  const firstRepository: OnboardingRepositoryOption | undefined = repositoryOptions[0];
  return firstRepository === undefined ? null : readGitFormInputForRepository(firstRepository, current, input);
}

function readGitFormInputForRepository(
  repository: OnboardingRepositoryOption,
  current: GitConnectFormInput | null,
  input: Readonly<InitialGitFormInputOptions>,
): GitConnectFormInput {
  return {
    branchName: current?.branchName ?? input.initialBranchName ?? repository.defaultBranchName,
    environmentName: current?.environmentName ?? input.initialEnvironmentName ?? defaultCompartmentEnvironmentName,
    repository,
  };
}

function readRepositoryOption(
  repositoryOptions: OnboardingRepositoryOption[],
  input: Readonly<InitialGitFormInputOptions>,
): OnboardingRepositoryOption | undefined {
  return input.selectedRepositoryId === undefined
    ? undefined
    : repositoryOptions.find((option: OnboardingRepositoryOption): boolean => option.id === input.selectedRepositoryId);
}

function readCurrentRepositoryOption(
  repositoryOptions: OnboardingRepositoryOption[],
  current: GitConnectFormInput | null,
): OnboardingRepositoryOption | undefined {
  return current === null
    ? undefined
    : repositoryOptions.find((option: OnboardingRepositoryOption): boolean => option.id === current.repository.id);
}
