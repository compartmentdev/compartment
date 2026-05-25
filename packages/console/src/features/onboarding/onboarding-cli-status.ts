import { useCallback, useEffect, useState } from 'react';
import type {
  FirstDeployOnboardingStatusKey,
  FirstDeployOnboardingStatusResponse,
} from '@compartment/contracts/browser';
import { readBrowserFirstDeployOnboardingStatus } from './onboarding-api';
import { startOnboardingStatusPolling } from './onboarding-status-polling';

interface CliDeployStatusPollingInput {
  onDeployStarted: () => void;
  selectedOrganizationSlug: string;
  sessionId: string;
}

interface CliLoginStatusPollingInput {
  onLoginConfirmed: () => void;
  selectedOrganizationSlug: string;
  sessionId: string;
}

export interface CliWaitingDeployStatus {
  refresh: () => Promise<void>;
  response: FirstDeployOnboardingStatusResponse | null;
}

class CliWaitingDeployStatusValue implements CliWaitingDeployStatus {
  public constructor(
    public readonly refresh: () => Promise<void>,
    public readonly response: FirstDeployOnboardingStatusResponse | null,
  ) {}
}

export function useCliLoginStatusNavigation(
  selectedOrganizationSlug: string,
  sessionId: string | undefined,
  onLoginConfirmed: () => void,
): void {
  useEffect((): (() => void) | undefined => {
    if (sessionId === undefined) {
      return undefined;
    }

    return startCliLoginStatusPolling({ onLoginConfirmed, selectedOrganizationSlug, sessionId });
  }, [onLoginConfirmed, selectedOrganizationSlug, sessionId]);
}

export async function refreshCliLoginStatus(
  selectedOrganizationSlug: string,
  sessionId: string | undefined,
  onLoginConfirmed: () => void,
): Promise<void> {
  if (sessionId === undefined) {
    return;
  }
  try {
    const response: FirstDeployOnboardingStatusResponse = await readBrowserFirstDeployOnboardingStatus(
      selectedOrganizationSlug,
      sessionId,
    );
    if (response.status === 'cli_login_authenticated') {
      onLoginConfirmed();
    }
  } catch {
    return;
  }
}

export function useCliDeployStatusNavigation(
  selectedOrganizationSlug: string,
  sessionId: string | undefined,
  onDeployStarted: () => void,
): void {
  useEffect((): (() => void) | undefined => {
    if (sessionId === undefined) {
      return undefined;
    }

    return startCliDeployStatusPolling({ onDeployStarted, selectedOrganizationSlug, sessionId });
  }, [onDeployStarted, selectedOrganizationSlug, sessionId]);
}

export function useCliWaitingDeployStatus(
  selectedOrganizationSlug: string,
  sessionId: string | undefined,
): CliWaitingDeployStatus {
  const [response, setResponse] = useState<FirstDeployOnboardingStatusResponse | null>(null);
  const refresh: () => Promise<void> = useCallback(async (): Promise<void> => {
    if (sessionId === undefined) {
      return;
    }
    try {
      setResponse(await readBrowserFirstDeployOnboardingStatus(selectedOrganizationSlug, sessionId));
    } catch {
      setResponse(null);
    }
  }, [selectedOrganizationSlug, sessionId]);

  useCliWaitingDeployStatusPolling(selectedOrganizationSlug, sessionId, setResponse);

  return new CliWaitingDeployStatusValue(refresh, response);
}

function useCliWaitingDeployStatusPolling(
  selectedOrganizationSlug: string,
  sessionId: string | undefined,
  setResponse: (response: FirstDeployOnboardingStatusResponse | null) => void,
): void {
  useEffect((): (() => void) | undefined => {
    if (sessionId === undefined) {
      return undefined;
    }
    return startOnboardingStatusPolling({
      onError: (): void => setResponse(null),
      onStatus: setResponse,
      selectedOrganizationSlug,
      sessionId,
    });
  }, [selectedOrganizationSlug, sessionId, setResponse]);
}

function startCliLoginStatusPolling(input: Readonly<CliLoginStatusPollingInput>): () => void {
  return startOnboardingStatusPolling({
    onStatus: (response: FirstDeployOnboardingStatusResponse): void => {
      if (response.status === 'cli_login_authenticated') {
        input.onLoginConfirmed();
      }
    },
    selectedOrganizationSlug: input.selectedOrganizationSlug,
    sessionId: input.sessionId,
  });
}

function startCliDeployStatusPolling(input: Readonly<CliDeployStatusPollingInput>): () => void {
  return startOnboardingStatusPolling({
    onStatus: (response: FirstDeployOnboardingStatusResponse): void => {
      if (isDeployStatus(response.status)) {
        input.onDeployStarted();
      }
    },
    selectedOrganizationSlug: input.selectedOrganizationSlug,
    sessionId: input.sessionId,
  });
}

function isDeployStatus(status: FirstDeployOnboardingStatusKey): boolean {
  return status === 'deploy_pending' || status === 'deploy_failed' || status === 'deploy_succeeded';
}
