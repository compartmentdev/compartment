import { useCallback, useEffect, useState } from 'react';
import type { FirstDeployOnboardingSessionResponse } from '@compartment/contracts/browser';
import {
  createDefaultOnboardingRouteState,
  createOnboardingRouteStateUrl,
  readCurrentOnboardingRouteState,
  writeOnboardingRouteState,
} from './onboarding-route-state';
import { readNextRouteState } from './onboarding-route-next-state';
import {
  createBrowserFirstDeployOnboardingSession,
  patchBrowserFirstDeployOnboardingSession,
  readBrowserFirstDeployOnboardingSession,
} from './onboarding-api';
import { BrowserApiError } from '../../lib/browser-api';
import type {
  OnboardingDeployMethod,
  OnboardingProcessStep,
  OnboardingProcessStepHrefReader,
  OnboardingRouteNavigate,
  OnboardingRouteState,
  OnboardingRouteStatePatch,
} from './onboarding-page.types';

export interface OnboardingRouteNavigation {
  navigate: OnboardingRouteNavigate;
  routeState: OnboardingRouteState;
}

export interface OnboardingSessionIssue {
  message: string;
}

class OnboardingSessionIssueValue implements OnboardingSessionIssue {
  constructor(public readonly message: string) {}
}

export function useOnboardingRouteNavigation(): OnboardingRouteNavigation {
  const [routeState, setRouteState] = useState<OnboardingRouteState>(readCurrentOnboardingRouteState);
  const navigate: OnboardingRouteNavigate = useCallback(
    (patch: OnboardingRouteStatePatch): void => {
      setRouteState((currentState: OnboardingRouteState): OnboardingRouteState => {
        const nextState: OnboardingRouteState = readNextRouteState(currentState, patch);
        writeOnboardingRouteState(nextState);
        return nextState;
      });
    },
    [setRouteState],
  );

  useEffect((): (() => void) => {
    function handlePopState(): void {
      setRouteState(readCurrentOnboardingRouteState());
    }

    window.addEventListener('popstate', handlePopState);
    return (): void => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  return { navigate, routeState };
}

export function readMethodSelectHandler(navigate: OnboardingRouteNavigate): (method: OnboardingDeployMethod) => void {
  return (method: OnboardingDeployMethod): void => {
    navigate({ method, step: 'prepare' });
  };
}

export function readStepHrefReader(routeState: OnboardingRouteState): OnboardingProcessStepHrefReader {
  return (step: OnboardingProcessStep): string | undefined => {
    if (isStepNavigationLocked(routeState)) {
      return undefined;
    }
    if (step === 'choose') {
      return createOnboardingRouteStateUrl({
        ...createDefaultOnboardingRouteState(),
        sessionId: routeState.sessionId,
      });
    }
    if (routeState.method === undefined) {
      return undefined;
    }
    return createOnboardingRouteStateUrl(readNextRouteState(routeState, { step }));
  };
}

function isStepNavigationLocked(routeState: OnboardingRouteState): boolean {
  return routeState.step === 'deploy' && !routeState.deployCompleted;
}

export function useEnsureOnboardingSession(
  selectedOrganizationSlug: string | null,
  routeState: OnboardingRouteState,
  navigate: OnboardingRouteNavigate,
): OnboardingSessionIssue | null {
  const [issueMessage, setIssueMessage] = useState<string | null>(null);
  useCreateOnboardingSession(selectedOrganizationSlug, routeState, navigate, setIssueMessage);
  usePatchOnboardingMethod(selectedOrganizationSlug, routeState, setIssueMessage);

  return issueMessage === null ? null : new OnboardingSessionIssueValue(issueMessage);
}

function useCreateOnboardingSession(
  selectedOrganizationSlug: string | null,
  routeState: OnboardingRouteState,
  navigate: OnboardingRouteNavigate,
  setIssueMessage: (message: string | null) => void,
): void {
  useEffect((): (() => void) => {
    if (selectedOrganizationSlug === null) {
      return clearOnboardingSessionIssue(setIssueMessage);
    }

    return startOnboardingSession(selectedOrganizationSlug, routeState, navigate, setIssueMessage);
  }, [navigate, routeState.sessionId, selectedOrganizationSlug, setIssueMessage]);
}

function clearOnboardingSessionIssue(setIssueMessage: (message: string | null) => void): () => void {
  setIssueMessage(null);
  return noopOnboardingEffectCleanup;
}

function noopOnboardingEffectCleanup(): void {
  return undefined;
}

function startOnboardingSession(
  selectedOrganizationSlug: string,
  routeState: OnboardingRouteState,
  navigate: OnboardingRouteNavigate,
  setIssueMessage: (message: string | null) => void,
): () => void {
  let canceled: boolean = false;
  void ensureOnboardingSession(selectedOrganizationSlug, routeState)
    .then((response: FirstDeployOnboardingSessionResponse | null): void => {
      handleOnboardingSessionReady(canceled, navigate, response, setIssueMessage);
    })
    .catch((): void => {
      handleOnboardingSessionIssue(canceled, setIssueMessage);
    });

  return (): void => {
    canceled = true;
  };
}

function handleOnboardingSessionReady(
  canceled: boolean,
  navigate: OnboardingRouteNavigate,
  response: FirstDeployOnboardingSessionResponse | null,
  setIssueMessage: (message: string | null) => void,
): void {
  if (canceled) {
    return;
  }

  setIssueMessage(null);
  navigateCreatedSession(navigate, response);
}

function handleOnboardingSessionIssue(canceled: boolean, setIssueMessage: (message: string | null) => void): void {
  if (!canceled) {
    setIssueMessage('Could not prepare the onboarding session.');
  }
}

async function ensureOnboardingSession(
  selectedOrganizationSlug: string,
  routeState: OnboardingRouteState,
): Promise<FirstDeployOnboardingSessionResponse | null> {
  if (routeState.sessionId !== undefined) {
    return await readOrReplaceOnboardingSession(selectedOrganizationSlug, routeState.sessionId);
  }
  return await createBrowserFirstDeployOnboardingSession(selectedOrganizationSlug, {});
}

async function readOrReplaceOnboardingSession(
  selectedOrganizationSlug: string,
  sessionId: string,
): Promise<FirstDeployOnboardingSessionResponse | null> {
  try {
    await readBrowserFirstDeployOnboardingSession(selectedOrganizationSlug, sessionId);
    return null;
  } catch (error) {
    if (!(error instanceof BrowserApiError) || error.status !== 404) {
      throw error;
    }

    return await createBrowserFirstDeployOnboardingSession(selectedOrganizationSlug, {});
  }
}

function navigateCreatedSession(
  navigate: OnboardingRouteNavigate,
  response: FirstDeployOnboardingSessionResponse | null,
): void {
  if (response !== null) {
    navigate({ sessionId: response.session.id });
  }
}

function usePatchOnboardingMethod(
  selectedOrganizationSlug: string | null,
  routeState: OnboardingRouteState,
  setIssueMessage: (message: string | null) => void,
): void {
  useEffect((): (() => void) | undefined => {
    if (selectedOrganizationSlug === null || routeState.sessionId === undefined || routeState.method !== 'cli') {
      return undefined;
    }
    let canceled: boolean = false;
    void patchOnboardingMethod(
      selectedOrganizationSlug,
      routeState.sessionId,
      setIssueMessage,
      (): boolean => canceled,
    );

    return (): void => {
      canceled = true;
    };
  }, [routeState.method, routeState.sessionId, selectedOrganizationSlug, setIssueMessage]);
}

async function patchOnboardingMethod(
  selectedOrganizationSlug: string,
  sessionId: string,
  setIssueMessage: (message: string | null) => void,
  isCanceled: () => boolean,
): Promise<void> {
  try {
    await patchBrowserFirstDeployOnboardingSession(selectedOrganizationSlug, sessionId, { method: 'cli' });
    if (!isCanceled()) {
      setIssueMessage(null);
    }
  } catch {
    if (!isCanceled()) {
      setIssueMessage('Could not update the onboarding session.');
    }
  }
}
