import { browserOnboardingPathname, browserProjectCreatePathname } from '../../browser-public-paths';
import { createDefaultGitRouteState, readGitRouteState, writeGitRouteSearchParams } from './onboarding-git-route-state';
import type { OnboardingDeployMethod, OnboardingProcessStep, OnboardingRouteState } from './onboarding-page.types';
import { readOptionalOnboardingSearchParam } from './onboarding-route-search-params';

type OnboardingStepSearchParam = 'choose' | 'deploy' | 'login' | 'setup' | 'source';

const onboardingSessionStorageKeyPrefix: string = 'compartment.onboarding.sessionId:';

const onboardingStepSearchParamByStep: Record<OnboardingProcessStep, OnboardingStepSearchParam> = {
  choose: 'choose',
  deploy: 'deploy',
  prepare: 'source',
  verify: 'setup',
};

export function readCurrentOnboardingRouteState(): OnboardingRouteState {
  if (typeof window === 'undefined') {
    return createDefaultOnboardingRouteState();
  }
  return readOnboardingRouteState(new URL(window.location.href));
}

export function writeOnboardingRouteState(state: OnboardingRouteState): void {
  if (typeof window === 'undefined') {
    return;
  }

  writeStoredOnboardingSessionId(readCurrentOnboardingPathname(), state.sessionId);
  const nextUrl: string = createOnboardingRouteStateUrl(state);
  if (nextUrl === readCurrentRelativeUrl()) {
    return;
  }
  window.history.pushState(null, '', nextUrl);
}

export function createOnboardingRouteStateUrl(state: OnboardingRouteState): string {
  const url: URL = new URL(readCurrentOnboardingPathname(), 'http://localhost');
  if (state.method === undefined || state.step === 'choose') {
    return createChoiceUrl(url, state.sessionId);
  }

  writeBaseRouteSearchParams(url, state);
  if (state.method === 'git') {
    writeGitRouteSearchParams(url, state);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function createChoiceUrl(url: URL, sessionId: string | undefined): string {
  if (sessionId !== undefined && shouldSerializeSessionId(url.pathname)) {
    url.searchParams.set('session', sessionId);
  }
  return `${url.pathname}${url.search}`;
}

function readCurrentRelativeUrl(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function readCurrentOnboardingPathname(): string {
  if (typeof window === 'undefined') {
    return browserOnboardingPathname;
  }

  return new URL(window.location.href).pathname;
}

function writeBaseRouteSearchParams(url: URL, state: OnboardingRouteState): void {
  if (state.sessionId !== undefined && shouldSerializeSessionId(url.pathname)) {
    url.searchParams.set('session', state.sessionId);
  }
  url.searchParams.set('method', state.method ?? 'cli');
  url.searchParams.set('step', onboardingStepSearchParamByStep[state.step]);
  if (state.deployCompleted) {
    url.searchParams.set('deploy', 'completed');
  }
}

function readOnboardingRouteState(url: URL): OnboardingRouteState {
  const method: OnboardingDeployMethod | undefined = readDeployMethod(url.searchParams);
  if (method === undefined) {
    return createDefaultOnboardingRouteState();
  }

  return {
    ...createDefaultOnboardingRouteState(),
    deployCompleted: url.searchParams.get('deploy') === 'completed',
    ...readGitRouteState(url, method),
    method,
    sessionId: readRouteSessionId(url),
    step: readProcessStep(url.searchParams),
  };
}

export function createDefaultOnboardingRouteState(): OnboardingRouteState {
  return {
    ...createDefaultGitRouteState(),
    deployCompleted: false,
    method: undefined,
    sessionId: readCurrentSessionId(),
    step: 'choose',
  };
}

function readCurrentSessionId(): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  const url: URL = new URL(window.location.href);
  return readRouteSessionId(url);
}

function readRouteSessionId(url: URL): string | undefined {
  const sessionId: string | undefined = readOptionalOnboardingSearchParam(url.searchParams, 'session');
  if (sessionId !== undefined) {
    return sessionId;
  }

  return readStoredOnboardingSessionId(url);
}

function readDeployMethod(searchParams: URLSearchParams): OnboardingDeployMethod | undefined {
  const method: string | null = searchParams.get('method');
  return method === 'cli' || method === 'git' ? method : undefined;
}

function readProcessStep(searchParams: URLSearchParams): OnboardingProcessStep {
  switch (searchParams.get('step')) {
    case 'deploy':
      return 'deploy';
    case 'setup':
      return 'verify';
    case 'login':
    case 'source':
      return 'prepare';
    case 'choose':
    case null:
    default:
      return 'prepare';
  }
}

function shouldSerializeSessionId(pathname: string): boolean {
  return !isProjectCreatePathname(pathname);
}

function readStoredOnboardingSessionId(url: URL): string | undefined {
  if (!isProjectCreatePathname(url.pathname)) {
    return undefined;
  }

  if (isFreshProjectCreateEntry(url)) {
    clearStoredOnboardingSessionId(url.pathname);
    return undefined;
  }

  try {
    return readOptionalSessionStorageValue(
      window.sessionStorage.getItem(readStoredOnboardingSessionStorageKey(url.pathname)),
    );
  } catch {
    return undefined;
  }
}

function writeStoredOnboardingSessionId(pathname: string, sessionId: string | undefined): void {
  if (!isProjectCreatePathname(pathname)) {
    return;
  }

  try {
    if (sessionId === undefined) {
      clearStoredOnboardingSessionId(pathname);
      return;
    }

    window.sessionStorage.setItem(readStoredOnboardingSessionStorageKey(pathname), sessionId);
  } catch {
    return;
  }
}

function clearStoredOnboardingSessionId(pathname: string): void {
  try {
    window.sessionStorage.removeItem(readStoredOnboardingSessionStorageKey(pathname));
  } catch {
    return;
  }
}

function readStoredOnboardingSessionStorageKey(pathname: string): string {
  return `${onboardingSessionStorageKeyPrefix}${pathname}`;
}

function isFreshProjectCreateEntry(url: URL): boolean {
  return !url.searchParams.has('deploy') && !url.searchParams.has('method') && !url.searchParams.has('step');
}

function isProjectCreatePathname(pathname: string): boolean {
  return pathname === browserProjectCreatePathname || /^\/orgs\/[^/]+\/projects\/create$/.test(pathname);
}

function readOptionalSessionStorageValue(value: string | null): string | undefined {
  return value === null || value === '' ? undefined : value;
}
