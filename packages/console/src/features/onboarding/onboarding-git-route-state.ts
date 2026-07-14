import {
  gitProviderHostSchema,
  gitHubAccountDiscoverySessionSearchParamName,
  gitHubAccountDiscoveryTokenSearchParamName,
} from '@compartment/contracts/browser';
import { appendOptionalSearchParam } from '@compartment/utils';
import type { OnboardingDeployMethod, OnboardingPullRequestState, OnboardingRouteState } from './onboarding-page.types';
import { readOptionalOnboardingSearchParam } from './onboarding-route-search-params';

type GitStringRouteStateKey =
  | 'branchName'
  | 'descriptorPath'
  | 'environmentName'
  | 'gitAccountDiscoverySessionId'
  | 'gitAccountDiscoveryToken'
  | 'projectName'
  | 'providerHost'
  | 'pullRequestStatusToken'
  | 'registrationId'
  | 'repositoryId'
  | 'repositoryName'
  | 'repositoryOwner'
  | 'sourceId'
  | 'syncTaskId';

type GitRouteState = Pick<
  OnboardingRouteState,
  GitStringRouteStateKey | 'gitConnected' | 'provider' | 'pullRequestNumber' | 'pullRequestState'
>;

interface GitStringSearchParamDefinition {
  name: string;
  stateKey: GitStringRouteStateKey;
}

const gitStringSearchParamDefinitions: GitStringSearchParamDefinition[] = [
  { name: 'branch', stateKey: 'branchName' },
  { name: 'descriptor', stateKey: 'descriptorPath' },
  { name: 'env', stateKey: 'environmentName' },
  { name: 'owner', stateKey: 'repositoryOwner' },
  { name: 'project', stateKey: 'projectName' },
  { name: 'registration', stateKey: 'registrationId' },
  { name: 'repo', stateKey: 'repositoryId' },
  { name: 'repository', stateKey: 'repositoryName' },
  { name: 'source', stateKey: 'sourceId' },
  { name: 'sync', stateKey: 'syncTaskId' },
];

const gitPullRequestStatusTokenFragmentParamName: string = 'pr_token';

export function writeGitRouteSearchParams(url: URL, state: OnboardingRouteState): void {
  for (const definition of gitStringSearchParamDefinitions) {
    appendOptionalSearchParam(url.searchParams, definition.name, state[definition.stateKey]);
  }
  writeOptionalNumberSearchParam(url, 'pr_number', state.pullRequestNumber);
  if (state.gitConnected) {
    url.searchParams.set('git', 'connected');
  }
  if (state.pullRequestState !== undefined) {
    url.searchParams.set('pr', state.pullRequestState);
  }
  if (state.provider !== undefined) url.searchParams.set('provider', state.provider);
  writeGitFragmentParams(url, state);
}

export function readGitRouteState(url: URL, method: OnboardingDeployMethod): Partial<GitRouteState> {
  if (method !== 'git') {
    return {};
  }
  return {
    ...readGitStringRouteState(url),
    gitConnected: url.searchParams.get('git') === 'connected',
    provider: readGitProvider(url.searchParams),
    pullRequestNumber: readOptionalPositiveInteger(url.searchParams, 'pr_number'),
    pullRequestState: readPullRequestState(url.searchParams),
  };
}

function readGitProvider(searchParams: URLSearchParams): 'github' | 'gitlab' | undefined {
  const provider: string | null = searchParams.get('provider');
  return provider === 'github' || provider === 'gitlab' ? provider : undefined;
}

export function createDefaultGitRouteState(): GitRouteState {
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
    pullRequestState: undefined,
    pullRequestStatusToken: undefined,
    registrationId: undefined,
    repositoryId: undefined,
    repositoryName: undefined,
    repositoryOwner: undefined,
    sourceId: undefined,
    syncTaskId: undefined,
  };
}

function writeGitFragmentParams(url: URL, state: OnboardingRouteState): void {
  const fragmentParams: URLSearchParams = readRouteFragmentParams(url);
  if (state.gitAccountDiscoverySessionId !== undefined) {
    fragmentParams.set(gitHubAccountDiscoverySessionSearchParamName, state.gitAccountDiscoverySessionId);
  }
  if (state.gitAccountDiscoveryToken !== undefined) {
    fragmentParams.set(gitHubAccountDiscoveryTokenSearchParamName, state.gitAccountDiscoveryToken);
  }
  if (state.pullRequestStatusToken !== undefined) {
    appendOptionalSearchParam(fragmentParams, gitPullRequestStatusTokenFragmentParamName, state.pullRequestStatusToken);
  }
  const fragment: string = fragmentParams.toString();
  if (fragment !== '') {
    url.hash = fragment;
  }
}

function readGitStringRouteState(url: URL): Pick<OnboardingRouteState, GitStringRouteStateKey> {
  return {
    branchName: readOptionalOnboardingSearchParam(url.searchParams, 'branch'),
    descriptorPath: readOptionalOnboardingSearchParam(url.searchParams, 'descriptor'),
    environmentName: readOptionalOnboardingSearchParam(url.searchParams, 'env'),
    ...readGitAccountDiscoveryRouteState(url),
    projectName: readOptionalOnboardingSearchParam(url.searchParams, 'project'),
    providerHost: readProviderHost(url.searchParams),
    pullRequestStatusToken: readOptionalOnboardingSearchParam(
      readRouteFragmentParams(url),
      gitPullRequestStatusTokenFragmentParamName,
    ),
    registrationId: readOptionalOnboardingSearchParam(url.searchParams, 'registration'),
    repositoryId: readOptionalOnboardingSearchParam(url.searchParams, 'repo'),
    repositoryName: readOptionalOnboardingSearchParam(url.searchParams, 'repository'),
    repositoryOwner: readOptionalOnboardingSearchParam(url.searchParams, 'owner'),
    sourceId: readOptionalOnboardingSearchParam(url.searchParams, 'source'),
    syncTaskId: readOptionalOnboardingSearchParam(url.searchParams, 'sync'),
  };
}

function readProviderHost(searchParams: URLSearchParams): string | undefined {
  const value: string | undefined = readOptionalOnboardingSearchParam(searchParams, 'provider_host');
  if (value === undefined) return undefined;
  try {
    return gitProviderHostSchema.parse(value);
  } catch {
    return undefined;
  }
}

function readGitAccountDiscoveryRouteState(
  url: URL,
): Pick<OnboardingRouteState, 'gitAccountDiscoverySessionId' | 'gitAccountDiscoveryToken'> {
  const fragmentParams: URLSearchParams = readRouteFragmentParams(url);
  return {
    gitAccountDiscoverySessionId: readOptionalRouteParam(
      url.searchParams,
      fragmentParams,
      gitHubAccountDiscoverySessionSearchParamName,
    ),
    gitAccountDiscoveryToken: readOptionalOnboardingSearchParam(
      fragmentParams,
      gitHubAccountDiscoveryTokenSearchParamName,
    ),
  };
}

function writeOptionalNumberSearchParam(url: URL, name: string, value: number | undefined): void {
  if (value !== undefined) {
    url.searchParams.set(name, value.toString());
  }
}

function readPullRequestState(searchParams: URLSearchParams): OnboardingPullRequestState | undefined {
  const state: string | null = searchParams.get('pr');
  return state === 'merged' || state === 'pending' ? state : undefined;
}

function readOptionalPositiveInteger(searchParams: URLSearchParams, name: string): number | undefined {
  const value: string | undefined = readOptionalOnboardingSearchParam(searchParams, name);
  if (value === undefined) {
    return undefined;
  }
  const parsed: number = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function readOptionalRouteParam(
  searchParams: URLSearchParams,
  fragmentParams: URLSearchParams,
  name: string,
): string | undefined {
  return (
    readOptionalOnboardingSearchParam(fragmentParams, name) ?? readOptionalOnboardingSearchParam(searchParams, name)
  );
}

function readRouteFragmentParams(url: URL): URLSearchParams {
  return new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
}
