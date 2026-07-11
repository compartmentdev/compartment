import { useState, type Dispatch, type SetStateAction } from 'react';
import {
  readGitSourceDescriptorDirectory,
  type GitDescriptorCandidate,
  type GitDescriptorPlanResponse,
} from '@compartment/contracts/browser';
import { readBrowserGitDescriptorPlan } from './onboarding-git-api';
import {
  useGitRepositoryOptions,
  type GitRepositoryLoadStatus,
  type GitRepositoryOptionsState,
} from './onboarding-git-repository-options-state';
import type {
  GitConnectFormInput,
  GitConnectFormPatch,
  GitDescriptorTargetOption,
  OnboardingRepositoryOption,
  OnboardingGitProvider,
} from './onboarding-page.types';

export interface GitOnboardingState {
  formInput: GitConnectFormInput | null;
  loadDescriptorTargets: () => Promise<GitDescriptorLoadResult>;
  onFormChange: (patch: GitConnectFormPatch) => void;
  onRepositoryChange: (repositoryId: string) => void;
  onTargetChange: (targetId: string) => void;
  reloadRepositories: () => void;
  repositoryLoadStatus: GitRepositoryLoadStatus;
  repositoryOptions: OnboardingRepositoryOption[];
  target: GitDescriptorTargetOption | null;
  targetOptions: GitDescriptorTargetOption[];
}

export interface GitDescriptorLoadResult {
  status: 'descriptor_found' | 'descriptor_missing';
  targets: GitDescriptorTargetOption[];
}

interface UseGitOnboardingStateInput {
  initialBranchName: string | undefined;
  initialEnvironmentName: string | undefined;
  provider: OnboardingGitProvider;
  providerHost: string;
  registrationId: string | undefined;
  repositoryOwner: string | undefined;
  sessionId: string | undefined;
  selectedRepositoryId: string | undefined;
  selectedOrganizationSlug: string;
}

interface GitOnboardingStateInput {
  formInput: GitConnectFormInput | null;
  reloadRepositories: () => void;
  repositoryLoadStatus: GitRepositoryLoadStatus;
  repositoryOptions: OnboardingRepositoryOption[];
  selectedOrganizationSlug: string;
  setFormInput: Dispatch<SetStateAction<GitConnectFormInput | null>>;
  setTarget: Dispatch<SetStateAction<GitDescriptorTargetOption | null>>;
  setTargetOptions: Dispatch<SetStateAction<GitDescriptorTargetOption[]>>;
  target: GitDescriptorTargetOption | null;
  targetOptions: GitDescriptorTargetOption[];
}

class GitOnboardingStateValue implements GitOnboardingState {
  public constructor(private readonly input: Readonly<GitOnboardingStateInput>) {}

  public get formInput(): GitConnectFormInput | null {
    return this.input.formInput;
  }

  public get repositoryOptions(): OnboardingRepositoryOption[] {
    return this.input.repositoryOptions;
  }

  public get repositoryLoadStatus(): GitRepositoryLoadStatus {
    return this.input.repositoryLoadStatus;
  }

  public get target(): GitDescriptorTargetOption | null {
    return this.input.target;
  }

  public get targetOptions(): GitDescriptorTargetOption[] {
    return this.input.targetOptions;
  }

  public readonly onFormChange: (patch: GitConnectFormPatch) => void = (patch: GitConnectFormPatch): void => {
    this.input.setFormInput((current: GitConnectFormInput | null): GitConnectFormInput | null =>
      current === null ? null : readUpdatedGitFormInput(current, patch),
    );
  };

  public readonly onRepositoryChange: (repositoryId: string) => void = (repositoryId: string): void => {
    this.input.setFormInput((current: GitConnectFormInput | null): GitConnectFormInput | null =>
      readGitRepositoryUpdate(this.input.repositoryOptions, repositoryId, current),
    );
  };

  public readonly onTargetChange: (targetId: string) => void = (targetId: string): void => {
    this.input.setTarget(readDescriptorTargetUpdate(this.input.targetOptions, targetId));
  };

  public readonly reloadRepositories: () => void = (): void => {
    this.input.reloadRepositories();
  };

  public readonly loadDescriptorTargets: () => Promise<GitDescriptorLoadResult> =
    async (): Promise<GitDescriptorLoadResult> => {
      return await loadDescriptorTargets(this.input);
    };
}

export function useGitOnboardingState(input: UseGitOnboardingStateInput): GitOnboardingState {
  const repositoryState: GitRepositoryOptionsState = useGitRepositoryOptions(input);
  const [targetOptions, setTargetOptions] = useState<GitDescriptorTargetOption[]>([]);
  const [target, setTarget] = useState<GitDescriptorTargetOption | null>(null);

  return new GitOnboardingStateValue({
    formInput: repositoryState.formInput,
    reloadRepositories: repositoryState.reloadRepositories,
    repositoryLoadStatus: repositoryState.repositoryLoadStatus,
    repositoryOptions: repositoryState.repositoryOptions,
    selectedOrganizationSlug: input.selectedOrganizationSlug,
    setFormInput: repositoryState.setFormInput,
    setTarget,
    setTargetOptions,
    target,
    targetOptions,
  });
}

async function loadDescriptorTargets(input: Readonly<GitOnboardingStateInput>): Promise<GitDescriptorLoadResult> {
  if (input.formInput === null) {
    return { status: 'descriptor_missing', targets: [] };
  }
  const plan: GitDescriptorPlanResponse = await readBrowserGitDescriptorPlan(input.selectedOrganizationSlug, {
    branchName: input.formInput.branchName,
    providerHost: input.formInput.repository.providerHost,
    registrationId: input.formInput.repository.registrationId,
    repositoryName: input.formInput.repository.name,
    repositoryOwner: input.formInput.repository.owner,
  });
  const targetOptions: GitDescriptorTargetOption[] = readDescriptorTargetOptions(plan, input.formInput);
  input.setTargetOptions(targetOptions);
  input.setTarget(targetOptions[0] ?? null);
  return { status: plan.status, targets: targetOptions };
}

function readGitRepositoryUpdate(
  repositoryOptions: OnboardingRepositoryOption[],
  repositoryId: string,
  current: GitConnectFormInput | null,
): GitConnectFormInput | null {
  const repository: OnboardingRepositoryOption | undefined = repositoryOptions.find(
    (option: OnboardingRepositoryOption): boolean => option.id === repositoryId,
  );
  if (current === null || repository === undefined) {
    return current;
  }

  return {
    ...current,
    branchName: repository.defaultBranchName,
    repository,
  };
}

function readUpdatedGitFormInput(current: GitConnectFormInput, patch: GitConnectFormPatch): GitConnectFormInput {
  return {
    branchName: patch.branchName ?? current.branchName,
    environmentName: patch.environmentName ?? current.environmentName,
    repository: current.repository,
  };
}

function readDescriptorTargetUpdate(
  targetOptions: GitDescriptorTargetOption[],
  targetId: string,
): (current: GitDescriptorTargetOption | null) => GitDescriptorTargetOption | null {
  return (current: GitDescriptorTargetOption | null): GitDescriptorTargetOption | null =>
    targetOptions.find((target: GitDescriptorTargetOption): boolean => target.id === targetId) ?? current;
}

function readDescriptorTargetOptions(
  plan: GitDescriptorPlanResponse,
  formInput: GitConnectFormInput,
): GitDescriptorTargetOption[] {
  return plan.status === 'descriptor_found'
    ? [
        {
          descriptorPath: plan.descriptorPath ?? 'compartment.yml',
          directory: readGitSourceDescriptorDirectory(plan.descriptorPath ?? 'compartment.yml'),
          files: [
            {
              content: plan.preview ?? '',
              path: plan.descriptorPath ?? 'compartment.yml',
            },
          ],
          id: 'existing',
          packageJsonPath: null,
          projectName: formInput.repository.name,
        },
      ]
    : plan.candidates.map(toDescriptorTargetOption);
}

function toDescriptorTargetOption(candidate: GitDescriptorCandidate): GitDescriptorTargetOption {
  return {
    descriptorPath: candidate.descriptorPath,
    directory: candidate.appFolder,
    files: candidate.files,
    id: candidate.id,
    packageJsonPath: candidate.packageJsonPath,
    projectName: candidate.projectName,
  };
}
