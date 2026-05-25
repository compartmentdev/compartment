import { useEffect, useState } from 'react';
import { readGitSourceDescriptorDirectory } from '@compartment/contracts/browser';
import type {
  GitConnectFormInput,
  GitDescriptorTargetOption,
  OnboardingPullRequestState,
  OnboardingRouteState,
} from './onboarding-page.types';
import type { GitDescriptorLoadResult } from './onboarding-git-state';

interface DescriptorTargetsLoaderInput {
  descriptorPath: string | undefined;
  formInput: GitConnectFormInput | null;
  loadDescriptorTargets: () => Promise<GitDescriptorLoadResult>;
  projectName: string | undefined;
  pullRequestState: OnboardingPullRequestState | undefined;
  target: GitDescriptorTargetOption | null;
}

type PendingPullRequestTargetInput = Pick<OnboardingRouteState, 'descriptorPath' | 'projectName' | 'pullRequestState'>;

export function useDescriptorTargetsLoader(input: Readonly<DescriptorTargetsLoaderInput>): void {
  const [requestedKey, setRequestedKey] = useState<string | null>(null);
  const requestKey: string | null = readDescriptorPlanRequestKey(input.formInput);
  const pendingTarget: GitDescriptorTargetOption | null = readPendingPullRequestTarget(input);
  const hasTarget: boolean = input.target !== null || pendingTarget !== null;

  useEffect((): void => {
    if (input.formInput === null || hasTarget || requestKey === null || requestedKey === requestKey) {
      return;
    }
    setRequestedKey(requestKey);
    void input.loadDescriptorTargets();
  }, [hasTarget, input, requestKey, requestedKey]);
}

export function readPendingPullRequestTarget(
  input: Readonly<PendingPullRequestTargetInput>,
): GitDescriptorTargetOption | null {
  if (input.pullRequestState !== 'pending' || input.descriptorPath === undefined || input.projectName === undefined) {
    return null;
  }

  return {
    descriptorPath: input.descriptorPath,
    directory: readGitSourceDescriptorDirectory(input.descriptorPath),
    files: [],
    id: 'pending',
    packageJsonPath: null,
    projectName: input.projectName,
  };
}

export function readDescriptorTargetOptions(
  targetOptions: GitDescriptorTargetOption[],
  target: GitDescriptorTargetOption,
): GitDescriptorTargetOption[] {
  return targetOptions.length === 0 ? [target] : targetOptions;
}

function readDescriptorPlanRequestKey(formInput: GitConnectFormInput | null): string | null {
  if (formInput === null) {
    return null;
  }
  return [
    formInput.repository.registrationId,
    formInput.repository.owner,
    formInput.repository.name,
    formInput.branchName,
  ].join(':');
}
