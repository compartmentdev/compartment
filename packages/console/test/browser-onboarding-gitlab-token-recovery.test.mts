// @vitest-environment jsdom

import {
  compartmentGitLabTokenInvalidErrorCode,
  type GitProviderRegistrationRepositoryListResponse,
} from '@compartment/contracts/browser';
import * as React from 'react';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { GitOnboardingPanel } from '../src/features/onboarding/onboarding-git-panel';
import type { OnboardingRouteState } from '../src/features/onboarding/onboarding-page.types';
import type { listBrowserGitProviderRepositories } from '../src/features/onboarding/onboarding-git-api';
import { BrowserApiError } from '../src/lib/browser-api';

type ListBrowserGitProviderRepositories = typeof listBrowserGitProviderRepositories;

const mocks: { listRepositories: Mock<ListBrowserGitProviderRepositories> } = vi.hoisted(
  (): { listRepositories: Mock<ListBrowserGitProviderRepositories> } => ({
    listRepositories: vi.fn<ListBrowserGitProviderRepositories>(),
  }),
);

vi.mock('../src/features/onboarding/onboarding-git-api', (): object => ({
  listBrowserGitProviderRepositories: mocks.listRepositories,
  listBrowserGitProviderRegistrations: async (): Promise<{ registrations: [] }> =>
    await Promise.resolve({ registrations: [] }),
}));

interface MountedGitOnboardingPanel {
  container: HTMLDivElement;
  render: (routeState: OnboardingRouteState) => Promise<void>;
  unmount: () => Promise<void>;
}

class MountedGitOnboardingPanelValue implements MountedGitOnboardingPanel {
  public constructor(
    public readonly container: HTMLDivElement,
    private readonly root: Root,
  ) {}

  public async render(routeState: OnboardingRouteState): Promise<void> {
    await act(async (): Promise<void> => {
      this.root.render(createGitOnboardingPanelElement(routeState));
      await flushEffects();
    });
  }

  public async unmount(): Promise<void> {
    await act(async (): Promise<void> => {
      this.root.unmount();
      await flushEffects();
    });
    this.container.remove();
  }
}

configureReactActEnvironment();

afterEach((): void => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('browser onboarding GitLab token recovery', (): void => {
  it('renders a re-entry action when the initial repository load rejects the token', async (): Promise<void> => {
    mocks.listRepositories.mockRejectedValueOnce(createTokenInvalidError());
    const panel: MountedGitOnboardingPanel = await mountGitOnboardingPanel(createGitLabRouteState(true));

    try {
      expect(panel.container.textContent).toContain('GitLab token could not be used.');
      expect(panel.container.textContent).toContain('Re-enter token');
    } finally {
      await panel.unmount();
    }
  });

  it('reloads the same registration after reconnecting', async (): Promise<void> => {
    mocks.listRepositories.mockResolvedValue(createRepositoryListResponse());
    const panel: MountedGitOnboardingPanel = await mountGitOnboardingPanel(createGitLabRouteState(true));

    try {
      await panel.render(createGitLabRouteState(false));
      await panel.render(createGitLabRouteState(true));

      expect(mocks.listRepositories).toHaveBeenCalledTimes(2);
      expect(panel.container.textContent).toContain('Choose repository');
      expect(panel.container.textContent).toContain('acme/web');
    } finally {
      await panel.unmount();
    }
  });

  it('replaces a loaded picker with token re-entry after Refresh detects revocation', async (): Promise<void> => {
    mocks.listRepositories
      .mockResolvedValueOnce(createRepositoryListResponse())
      .mockRejectedValueOnce(createTokenInvalidError());
    const panel: MountedGitOnboardingPanel = await mountGitOnboardingPanel(createGitLabRouteState(true));

    try {
      await clickButton(panel.container, 'Refresh');

      expect(panel.container.textContent).toContain('GitLab token could not be used.');
      expect(panel.container.textContent).toContain('Re-enter token');
      expect(panel.container.textContent).not.toContain('Choose repository');
    } finally {
      await panel.unmount();
    }
  });

  it('clears stale repository state when the registration changes', async (): Promise<void> => {
    mocks.listRepositories.mockResolvedValueOnce(createRepositoryListResponse()).mockResolvedValueOnce({
      repositories: [
        { defaultBranchName: 'main', fullName: 'beta/api', id: '84', name: 'api', owner: 'beta', private: true },
      ],
    });
    const panel: MountedGitOnboardingPanel = await mountGitOnboardingPanel(createGitLabRouteState(true));
    try {
      await panel.render({
        ...createGitLabRouteState(true),
        provider: 'github',
        providerHost: 'github.com',
        registrationId: 'gpr_456',
      });
      expect(mocks.listRepositories).toHaveBeenLastCalledWith('acme-dev', 'gpr_456');
      expect(panel.container.textContent).toContain('beta/api');
      expect(panel.container.textContent).not.toContain('acme/web');
    } finally {
      await panel.unmount();
    }
  });
});

function createGitOnboardingPanelElement(routeState: OnboardingRouteState): ReactElement {
  return React.createElement(GitOnboardingPanel, {
    consoleOrigin: 'http://console.localhost:38080',
    navigate: (): void => undefined,
    routeState,
    selectedOrganizationSlug: 'acme-dev',
  });
}

async function mountGitOnboardingPanel(routeState: OnboardingRouteState): Promise<MountedGitOnboardingPanel> {
  const container: HTMLDivElement = document.createElement('div');
  const panel: MountedGitOnboardingPanel = new MountedGitOnboardingPanelValue(container, createRoot(container));
  document.body.append(container);
  await panel.render(routeState);
  return panel;
}

function createGitLabRouteState(gitConnected: boolean): OnboardingRouteState {
  return {
    branchName: undefined,
    deployCompleted: false,
    descriptorPath: undefined,
    environmentName: undefined,
    gitAccountDiscoverySessionId: undefined,
    gitAccountDiscoveryToken: undefined,
    gitConnected,
    method: 'git',
    projectName: undefined,
    provider: 'gitlab',
    providerHost: 'gitlab.com',
    pullRequestNumber: undefined,
    pullRequestState: undefined,
    pullRequestStatusToken: undefined,
    registrationId: 'gpr_123',
    repositoryId: undefined,
    repositoryName: undefined,
    repositoryOwner: undefined,
    sessionId: undefined,
    sourceId: undefined,
    step: 'prepare',
    syncTaskId: undefined,
  };
}

function createRepositoryListResponse(): GitProviderRegistrationRepositoryListResponse {
  return {
    repositories: [
      {
        defaultBranchName: 'main',
        fullName: 'acme/web',
        id: '42',
        name: 'web',
        owner: 'acme',
        private: true,
      },
    ],
  };
}

function createTokenInvalidError(): BrowserApiError {
  return new BrowserApiError(401, 'The GitLab token is invalid.', compartmentGitLabTokenInvalidErrorCode);
}

async function clickButton(container: HTMLElement, label: string): Promise<void> {
  const button: HTMLButtonElement | undefined = [...container.querySelectorAll('button')].find(
    (candidate: HTMLButtonElement): boolean => candidate.textContent.includes(label),
  );
  if (button === undefined) throw new Error(`Expected button with label ${label}.`);

  await act(async (): Promise<void> => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushEffects();
  });
}

async function flushEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function configureReactActEnvironment(): void {
  const globalState: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis;
  globalState.IS_REACT_ACT_ENVIRONMENT = true;
}
