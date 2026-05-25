import type { JSX } from 'react';
import { OnboardingStatus, type OnboardingStatusState } from './onboarding-shared';

interface GitLoadingStepProps {
  label: string;
  onRefresh?: (() => void) | undefined;
  state?: OnboardingStatusState | undefined;
  value: string;
}

export function GitLoadingStep({ label, onRefresh, state, value }: Readonly<GitLoadingStepProps>): JSX.Element {
  return (
    <div className="p-5">
      <OnboardingStatus label={label} onRefresh={onRefresh} state={state} value={value} />
    </div>
  );
}
