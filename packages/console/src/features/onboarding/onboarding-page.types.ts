import type { GitDescriptorDraftFile } from '@compartment/contracts/browser';

export type OnboardingDeployMethod = 'cli' | 'git';
export type OnboardingProcessStep = 'choose' | 'deploy' | 'prepare' | 'verify';
export type OnboardingPullRequestState = 'merged' | 'pending';

export interface OnboardingRouteState {
  branchName: string | undefined;
  descriptorPath: string | undefined;
  deployCompleted: boolean;
  environmentName: string | undefined;
  gitAccountDiscoverySessionId: string | undefined;
  gitAccountDiscoveryToken: string | undefined;
  gitConnected: boolean;
  method: OnboardingDeployMethod | undefined;
  projectName: string | undefined;
  pullRequestNumber: number | undefined;
  pullRequestState: OnboardingPullRequestState | undefined;
  pullRequestStatusToken: string | undefined;
  registrationId: string | undefined;
  repositoryId: string | undefined;
  repositoryName: string | undefined;
  repositoryOwner: string | undefined;
  sessionId: string | undefined;
  sourceId: string | undefined;
  step: OnboardingProcessStep;
  syncTaskId: string | undefined;
}

export interface OnboardingRouteStatePatch {
  branchName?: string | undefined;
  descriptorPath?: string | undefined;
  deployCompleted?: boolean | undefined;
  environmentName?: string | undefined;
  gitAccountDiscoverySessionId?: string | undefined;
  gitAccountDiscoveryToken?: string | undefined;
  gitConnected?: boolean | undefined;
  method?: OnboardingDeployMethod | undefined;
  projectName?: string | undefined;
  pullRequestNumber?: number | undefined;
  pullRequestState?: OnboardingPullRequestState | undefined;
  pullRequestStatusToken?: string | undefined;
  registrationId?: string | undefined;
  repositoryId?: string | undefined;
  repositoryName?: string | undefined;
  repositoryOwner?: string | undefined;
  sessionId?: string | undefined;
  sourceId?: string | undefined;
  step?: OnboardingProcessStep | undefined;
  syncTaskId?: string | undefined;
}

export type OnboardingProcessStepHrefReader = (step: OnboardingProcessStep) => string | undefined;
export type OnboardingRouteNavigate = (patch: OnboardingRouteStatePatch) => void;

export interface GitConnectFormInput {
  branchName: string;
  environmentName: string;
  repository: OnboardingRepositoryOption;
}

export interface GitConnectFormPatch {
  branchName?: string | undefined;
  environmentName?: string | undefined;
}

export interface GitDescriptorTargetOption {
  descriptorPath: string;
  directory: string;
  files: GitDescriptorDraftFile[];
  id: string;
  packageJsonPath: string | null;
  projectName: string;
}

export interface OnboardingRepositoryOption {
  defaultBranchName: string;
  id: string;
  name: string;
  owner: string;
  registrationId: string;
}
