import type { FirstDeployOnboardingStatusKey } from '@compartment/contracts/browser';
import type { OnboardingStatusState } from './onboarding-shared';

export function readOnboardingDeployStatusState(
  status: FirstDeployOnboardingStatusKey | undefined,
): OnboardingStatusState {
  if (status === 'deploy_succeeded') {
    return 'success';
  }
  if (status === 'deploy_failed') {
    return 'error';
  }

  return 'active';
}
