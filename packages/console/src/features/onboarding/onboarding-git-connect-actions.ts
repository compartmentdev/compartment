import type { Dispatch, SetStateAction } from 'react';
import type {
  GitHubAccountDiscoveryAccount,
  GitHubAccountDiscoveryStartResponse,
  GitHubProviderBootstrapResponse,
} from '@compartment/contracts/browser';
import { startBrowserGitHubAccountDiscovery, startBrowserGitHubProviderBootstrap } from './onboarding-git-api';
import { gitOnboardingProviderHost } from './onboarding-git-constants';
import type { OnboardingRouteState } from './onboarding-page.types';
import { createDefaultOnboardingRouteState, createOnboardingRouteStateUrl } from './onboarding-route-state';

export type GitHubConnectStartStatus = 'failed' | 'idle' | 'loading';
export type GitHubAccountInstallStatus = 'failed' | 'idle' | 'loading';

export function readConnectClickHandler(
  consoleOrigin: string,
  selectedOrganizationSlug: string,
  sessionId: string | undefined,
  setStatus: Dispatch<SetStateAction<GitHubConnectStartStatus>>,
): () => void {
  return (): void => {
    if (sessionId === undefined) {
      return;
    }
    setStatus('loading');
    startGitHubAccountDiscovery(consoleOrigin, selectedOrganizationSlug, sessionId).catch((): void => {
      setStatus('failed');
    });
  };
}

export function readAccountSelectedHandler(
  selectedOrganizationSlug: string,
  sessionId: string | undefined,
  setInstallingAccountLogin: Dispatch<SetStateAction<string | null>>,
  setStatus: Dispatch<SetStateAction<GitHubAccountInstallStatus>>,
): (account: GitHubAccountDiscoveryAccount) => void {
  return (account: GitHubAccountDiscoveryAccount): void => {
    if (sessionId === undefined) {
      return;
    }
    setStatus('loading');
    setInstallingAccountLogin(account.login);
    startGitHubBootstrap(selectedOrganizationSlug, sessionId, account.login).catch((): void => {
      setStatus('failed');
      setInstallingAccountLogin(null);
    });
  };
}

async function startGitHubAccountDiscovery(
  consoleOrigin: string,
  selectedOrganizationSlug: string,
  sessionId: string,
): Promise<void> {
  const returnTo: string = new URL(buildGitHubDiscoveryReturnPath(sessionId), consoleOrigin).toString();
  const response: GitHubAccountDiscoveryStartResponse = await startBrowserGitHubAccountDiscovery(
    selectedOrganizationSlug,
    { returnTo },
  );
  window.location.assign(response.browserUrl);
}

async function startGitHubBootstrap(
  selectedOrganizationSlug: string,
  sessionId: string,
  repositoryOwner: string,
): Promise<void> {
  const response: GitHubProviderBootstrapResponse = await startBrowserGitHubProviderBootstrap(
    selectedOrganizationSlug,
    {
      providerHost: gitOnboardingProviderHost,
      repositoryOwner,
      returnTo: buildGitHubBootstrapReturnPath(sessionId, undefined, repositoryOwner),
    },
  );
  handleGitHubBootstrapResponse(response, sessionId);
}

function handleGitHubBootstrapResponse(response: GitHubProviderBootstrapResponse, sessionId: string): void {
  if (response.browserUrl !== null) {
    window.location.assign(response.browserUrl);
    return;
  }
  if (response.status === 'active') {
    window.location.assign(
      buildGitHubBootstrapReturnPath(sessionId, response.registrationId, response.repositoryOwner),
    );
    return;
  }
  throw new Error('GitHub bootstrap did not include a browser URL.');
}

function buildGitHubDiscoveryReturnPath(sessionId: string): string {
  return buildGitHubReturnPath(sessionId, false);
}

export function buildGitHubBootstrapReturnPath(
  sessionId: string,
  registrationId?: string,
  repositoryOwner?: string,
): string {
  return buildGitHubReturnPath(sessionId, true, registrationId, repositoryOwner);
}

function buildGitHubReturnPath(
  sessionId: string,
  gitConnected: boolean,
  registrationId?: string,
  repositoryOwner?: string,
): string {
  const state: OnboardingRouteState = {
    ...createDefaultOnboardingRouteState(),
    gitConnected,
    method: 'git',
    registrationId,
    repositoryOwner,
    sessionId,
    step: 'prepare',
  };
  return createOnboardingRouteStateUrl(state);
}
