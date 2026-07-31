import type { JSX } from 'react';
import { Button } from '../../components/ui/button';
import { GitBranch } from '../../components/ui/icons';
import type { OnboardingRouteNavigate } from './onboarding-page.types';

export function GitProviderSelect({ navigate }: Readonly<{ navigate: OnboardingRouteNavigate }>): JSX.Element {
  return (
    <div className="grid gap-5 p-5">
      <div>
        <h2 className="text-[24px] font-semibold leading-8">Choose a Git provider</h2>
        <p className="mt-2 text-[14px] leading-6 text-[#485259]">Connect the repository you want to deploy.</p>
      </div>
      <div className="flex gap-3">
        <Button onClick={(): void => navigate({ provider: 'github', providerHost: 'github.com' })} type="button">
          <GitBranch aria-hidden="true" size={15} /> GitHub
        </Button>
        <Button onClick={(): void => navigate({ provider: 'gitlab', providerHost: 'gitlab.com' })} type="button">
          <GitBranch aria-hidden="true" size={15} /> GitLab
        </Button>
      </div>
    </div>
  );
}
