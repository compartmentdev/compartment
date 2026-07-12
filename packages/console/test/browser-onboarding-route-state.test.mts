import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultOnboardingRouteState,
  createOnboardingRouteStateUrl,
  readCurrentOnboardingRouteState,
} from '../src/features/onboarding/onboarding-route-state';
import { readStepHrefReader } from '../src/features/onboarding/onboarding-navigation';
import { readNextRouteState } from '../src/features/onboarding/onboarding-route-next-state';
import type {
  OnboardingProcessStepHrefReader,
  OnboardingRouteState,
} from '../src/features/onboarding/onboarding-page.types';

describe('browser onboarding route state', (): void => {
  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  it('serializes CLI onboarding state and deploy completion', (): void => {
    expect(
      createOnboardingRouteStateUrl({
        ...createDefaultOnboardingRouteState(),
        deployCompleted: true,
        method: 'cli',
        sessionId: 'fdo_123',
        step: 'deploy',
      }),
    ).toBe('/onboarding?session=fdo_123&method=cli&step=deploy&deploy=completed');
  });

  it('preserves selected organization while serializing onboarding state', (): void => {
    vi.stubGlobal('window', {
      location: {
        href: 'http://console.localhost/orgs/beta-dev/onboarding',
      },
    });

    expect(
      createOnboardingRouteStateUrl({
        ...createDefaultOnboardingRouteState(),
        method: 'cli',
        sessionId: 'fdo_123',
        step: 'prepare',
      }),
    ).toBe('/orgs/beta-dev/onboarding?session=fdo_123&method=cli&step=source');
  });

  it('preserves create route path while serializing route state', (): void => {
    vi.stubGlobal('window', {
      location: {
        href: 'http://console.localhost/orgs/beta-dev/projects/create',
      },
    });

    expect(
      createOnboardingRouteStateUrl({
        ...createDefaultOnboardingRouteState(),
        method: 'cli',
        sessionId: 'fdo_123',
        step: 'prepare',
      }),
    ).toBe('/orgs/beta-dev/projects/create?method=cli&step=source');
  });

  it('restores create flow session from session storage when the URL omits it', (): void => {
    vi.stubGlobal('window', {
      location: {
        href: 'http://console.localhost/orgs/beta-dev/projects/create?method=cli&step=source',
      },
      sessionStorage: createSessionStorageMock({
        'compartment.onboarding.sessionId:/orgs/beta-dev/projects/create': 'fdo_123',
      }),
    });

    expect(readCurrentOnboardingRouteState()).toEqual({
      ...createDefaultOnboardingRouteState(),
      method: 'cli',
      sessionId: 'fdo_123',
      step: 'prepare',
    });
  });

  it('starts a fresh create flow from the entry URL even when a stored session exists', (): void => {
    const sessionStorage: Storage = createSessionStorageMock({
      'compartment.onboarding.sessionId:/orgs/beta-dev/projects/create': 'fdo_123',
    });

    vi.stubGlobal('window', {
      location: {
        href: 'http://console.localhost/orgs/beta-dev/projects/create',
      },
      sessionStorage,
    });

    expect(readCurrentOnboardingRouteState()).toEqual({
      ...createDefaultOnboardingRouteState(),
      method: undefined,
      sessionId: undefined,
      step: 'choose',
    });
    expect(sessionStorage.getItem('compartment.onboarding.sessionId:/orgs/beta-dev/projects/create')).toBeNull();
  });

  it('revives Git route state from a direct URL', (): void => {
    vi.stubGlobal('window', {
      location: {
        href:
          'http://console.localhost/onboarding?method=git&step=deploy&branch=main&env=production&owner=acme' +
          '&registration=gpr_123&repo=repo_123&repository=web&source=src_123&sync=sst_123&git=connected' +
          '&session=fdo_123&provider=gitlab&provider_host=gitlab.example.com#pr_token=prt_123',
      },
    });

    expect(readCurrentOnboardingRouteState()).toEqual({
      ...createDefaultOnboardingRouteState(),
      branchName: 'main',
      environmentName: 'production',
      gitConnected: true,
      method: 'git',
      provider: 'gitlab',
      providerHost: 'gitlab.example.com',
      registrationId: 'gpr_123',
      repositoryId: 'repo_123',
      repositoryName: 'web',
      repositoryOwner: 'acme',
      pullRequestStatusToken: 'prt_123',
      sessionId: 'fdo_123',
      sourceId: 'src_123',
      step: 'deploy',
      syncTaskId: 'sst_123',
    });
  });

  it('keeps legacy Git URLs compatible without provider parameters', (): void => {
    vi.stubGlobal('window', {
      location: { href: 'http://console.localhost/onboarding?method=git&step=prepare&git=connected' },
    });

    expect(readCurrentOnboardingRouteState()).toMatchObject({
      method: 'git',
      provider: undefined,
      providerHost: undefined,
      step: 'prepare',
    });
  });

  it('resets stale Git repository flow state when the repository changes', (): void => {
    const nextState: OnboardingRouteState = readNextRouteState(
      {
        ...createDefaultOnboardingRouteState(),
        branchName: 'main',
        descriptorPath: 'apps/billing/compartment.yml',
        environmentName: 'production',
        gitConnected: true,
        method: 'git',
        projectName: 'billing',
        pullRequestNumber: 12,
        pullRequestState: 'pending',
        pullRequestStatusToken: 'prt_123',
        registrationId: 'gpr_123',
        repositoryId: 'repo_123',
        repositoryName: 'mono',
        repositoryOwner: 'acme',
        sourceId: 'src_123',
        step: 'deploy',
        syncTaskId: 'sst_123',
      },
      {
        branchName: 'develop',
        environmentName: 'staging',
        repositoryId: 'repo_456',
        repositoryName: 'api',
      },
    );

    expect(nextState).toMatchObject({
      branchName: 'develop',
      descriptorPath: undefined,
      environmentName: 'staging',
      projectName: undefined,
      pullRequestNumber: undefined,
      pullRequestState: undefined,
      pullRequestStatusToken: undefined,
      repositoryId: 'repo_456',
      repositoryName: 'api',
      sourceId: undefined,
      syncTaskId: undefined,
    });
  });

  it('preserves the selected Git provider before connection', (): void => {
    const nextState: OnboardingRouteState = readNextRouteState(
      { ...createDefaultOnboardingRouteState(), method: 'git', step: 'prepare' },
      { provider: 'gitlab', providerHost: 'gitlab.example.com' },
    );

    expect(nextState).toMatchObject({ provider: 'gitlab', providerHost: 'gitlab.example.com' });
  });

  it('disables step links while first deployment is pending', (): void => {
    const readStepHref: OnboardingProcessStepHrefReader = readStepHrefReader({
      ...createDefaultOnboardingRouteState(),
      method: 'git',
      step: 'deploy',
    });

    expect(readStepHref('choose')).toBeUndefined();
    expect(readStepHref('prepare')).toBeUndefined();
    expect(readStepHref('verify')).toBeUndefined();
    expect(readStepHref('deploy')).toBeUndefined();
  });

  it('restores step links after first deployment completes', (): void => {
    const readStepHref: OnboardingProcessStepHrefReader = readStepHrefReader({
      ...createDefaultOnboardingRouteState(),
      deployCompleted: true,
      method: 'git',
      step: 'deploy',
    });

    expect(readStepHref('prepare')).toBe('/onboarding?method=git&step=source');
  });

  it('preserves selected organization in onboarding step links', (): void => {
    vi.stubGlobal('window', {
      location: {
        href: 'http://console.localhost/orgs/beta-dev/onboarding',
      },
    });
    const readStepHref: OnboardingProcessStepHrefReader = readStepHrefReader({
      ...createDefaultOnboardingRouteState(),
      deployCompleted: true,
      method: 'git',
      step: 'deploy',
    });

    expect(readStepHref('prepare')).toBe('/orgs/beta-dev/onboarding?method=git&step=source');
  });

  it('preserves create route path in step links', (): void => {
    vi.stubGlobal('window', {
      location: {
        href: 'http://console.localhost/orgs/beta-dev/projects/create',
      },
    });
    const readStepHref: OnboardingProcessStepHrefReader = readStepHrefReader({
      ...createDefaultOnboardingRouteState(),
      deployCompleted: true,
      method: 'git',
      step: 'deploy',
    });

    expect(readStepHref('prepare')).toBe('/orgs/beta-dev/projects/create?method=git&step=source');
  });
});

function createSessionStorageMock(initialState: Record<string, string>): Storage {
  return new SessionStorageMock(initialState);
}

class SessionStorageMock implements Storage {
  readonly #state: Map<string, string>;

  constructor(initialState: Record<string, string>) {
    this.#state = new Map<string, string>(Object.entries(initialState));
  }

  get length(): number {
    return this.#state.size;
  }

  clear(): void {
    this.#state.clear();
  }

  getItem(key: string): string | null {
    return this.#state.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.#state.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.#state.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#state.set(key, value);
  }
}
