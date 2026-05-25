import type { FirstDeployOnboardingStatusResponse } from '@compartment/contracts/browser';
import { readBrowserFirstDeployOnboardingStatus } from './onboarding-api';

export const onboardingStatusPollingIntervalMs: number = 2000;

interface OnboardingStatusPollingInput {
  onError?: () => void;
  onStatus: (response: FirstDeployOnboardingStatusResponse) => void;
  selectedOrganizationSlug: string;
  sessionId: string;
}

export function startOnboardingStatusPolling(input: Readonly<OnboardingStatusPollingInput>): () => void {
  let canceled: boolean = false;
  const syncStatus: () => void = (): void => {
    readBrowserFirstDeployOnboardingStatus(input.selectedOrganizationSlug, input.sessionId)
      .then((response: FirstDeployOnboardingStatusResponse): void => {
        if (!canceled) {
          input.onStatus(response);
        }
      })
      .catch((): void => {
        if (!canceled) {
          input.onError?.();
        }
      });
  };
  const intervalId: number = window.setInterval(syncStatus, onboardingStatusPollingIntervalMs);
  syncStatus();

  return (): void => {
    canceled = true;
    window.clearInterval(intervalId);
  };
}
