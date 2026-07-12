import { createDefaultOnboardingRouteState } from './onboarding-route-state';
import type {
  OnboardingDeployMethod,
  OnboardingPullRequestState,
  OnboardingRouteState,
  OnboardingRouteStatePatch,
} from './onboarding-page.types';

type GitRouteState = Omit<
  OnboardingRouteState,
  'deployCompleted' | 'method' | 'pullRequestState' | 'sessionId' | 'step'
>;

export function readNextRouteState(
  currentState: OnboardingRouteState,
  patch: OnboardingRouteStatePatch,
): OnboardingRouteState {
  const method: OnboardingDeployMethod | undefined = patch.method ?? currentState.method;
  if (method === undefined) {
    return {
      ...createDefaultOnboardingRouteState(),
      sessionId: patch.sessionId ?? currentState.sessionId,
    };
  }

  return {
    ...readNextGitRouteState(currentState, method, patch),
    deployCompleted: readNextDeployCompleted(currentState, method, patch),
    method,
    pullRequestState: readNextPullRequestState(currentState, method, patch),
    sessionId: patch.sessionId ?? currentState.sessionId,
    step: patch.step ?? currentState.step,
  };
}

function readNextDeployCompleted(
  currentState: OnboardingRouteState,
  method: OnboardingDeployMethod,
  patch: OnboardingRouteStatePatch,
): boolean {
  if (patch.deployCompleted !== undefined) {
    return patch.deployCompleted;
  }
  if (patch.step !== undefined && patch.step !== 'deploy') {
    return false;
  }
  if (currentState.method !== method) {
    return false;
  }

  return currentState.deployCompleted;
}

function readNextPullRequestState(
  currentState: OnboardingRouteState,
  method: OnboardingDeployMethod,
  patch: OnboardingRouteStatePatch,
): OnboardingPullRequestState | undefined {
  if (method === 'cli' || patch.gitConnected === false || patch.step === 'prepare') {
    return undefined;
  }
  if (patch.repositoryId !== undefined && patch.pullRequestState === undefined) {
    return undefined;
  }
  if (patch.pullRequestState !== undefined) {
    return patch.pullRequestState;
  }
  if (patch.step === 'verify' && currentState.pullRequestState === 'merged') {
    return undefined;
  }
  return currentState.pullRequestState;
}

function readNextGitRouteState(
  currentState: OnboardingRouteState,
  method: OnboardingDeployMethod,
  patch: OnboardingRouteStatePatch,
): GitRouteState {
  if (method === 'cli') {
    return createEmptyGitRouteState();
  }
  if (patch.gitConnected === false) {
    return {
      ...createEmptyGitRouteState(),
      provider: patch.provider ?? currentState.provider,
      providerHost: patch.providerHost ?? currentState.providerHost,
    };
  }

  const resetRepositoryFlow: boolean = patch.step === 'prepare' || patch.repositoryId !== undefined;
  return {
    ...readStableGitRouteState(currentState, patch),
    ...readResettableGitRouteState(currentState, patch, resetRepositoryFlow),
  };
}

function readStableGitRouteState(currentState: OnboardingRouteState, patch: OnboardingRouteStatePatch): GitRouteState {
  return {
    ...createEmptyGitRouteState(),
    branchName: patch.branchName ?? currentState.branchName,
    environmentName: patch.environmentName ?? currentState.environmentName,
    gitAccountDiscoverySessionId: patch.gitAccountDiscoverySessionId ?? currentState.gitAccountDiscoverySessionId,
    gitAccountDiscoveryToken: patch.gitAccountDiscoveryToken ?? currentState.gitAccountDiscoveryToken,
    gitConnected: patch.gitConnected ?? currentState.gitConnected,
    provider: patch.provider ?? currentState.provider,
    providerHost: patch.providerHost ?? currentState.providerHost,
    registrationId: patch.registrationId ?? currentState.registrationId,
    repositoryId: patch.repositoryId ?? currentState.repositoryId,
    repositoryName: patch.repositoryName ?? currentState.repositoryName,
    repositoryOwner: patch.repositoryOwner ?? currentState.repositoryOwner,
  };
}

function readResettableGitRouteState(
  currentState: OnboardingRouteState,
  patch: OnboardingRouteStatePatch,
  resetRepositoryFlow: boolean,
): Partial<GitRouteState> {
  return {
    descriptorPath: resetRepositoryFlow ? patch.descriptorPath : (patch.descriptorPath ?? currentState.descriptorPath),
    projectName: resetRepositoryFlow ? patch.projectName : (patch.projectName ?? currentState.projectName),
    pullRequestNumber: resetRepositoryFlow
      ? patch.pullRequestNumber
      : (patch.pullRequestNumber ?? currentState.pullRequestNumber),
    pullRequestStatusToken: resetRepositoryFlow
      ? patch.pullRequestStatusToken
      : (patch.pullRequestStatusToken ?? currentState.pullRequestStatusToken),
    sourceId: resetRepositoryFlow ? patch.sourceId : (patch.sourceId ?? currentState.sourceId),
    syncTaskId: resetRepositoryFlow ? patch.syncTaskId : (patch.syncTaskId ?? currentState.syncTaskId),
  };
}

function createEmptyGitRouteState(): GitRouteState {
  return {
    branchName: undefined,
    descriptorPath: undefined,
    environmentName: undefined,
    gitAccountDiscoverySessionId: undefined,
    gitAccountDiscoveryToken: undefined,
    gitConnected: false,
    projectName: undefined,
    provider: undefined,
    providerHost: undefined,
    pullRequestNumber: undefined,
    pullRequestStatusToken: undefined,
    registrationId: undefined,
    repositoryId: undefined,
    repositoryName: undefined,
    repositoryOwner: undefined,
    sourceId: undefined,
    syncTaskId: undefined,
  };
}
