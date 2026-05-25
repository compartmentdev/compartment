import type { JSX } from 'react';
import type { LoaderFunctionArgs } from 'react-router';
import { browserOnboardingPathname } from '../../browser-public-paths';
import { type FirstDeployHeaderCopy } from './first-deploy-header';
import { FirstDeployPage } from './first-deploy-page';
import { loadFirstDeployPageData } from './first-deploy-page-loader';
import type { OnboardingPageData } from './onboarding-page-data.types';

const onboardingHeaderCopy: FirstDeployHeaderCopy = {
  description: 'Choose how this runtime should receive application code.',
  eyebrow: 'Compartment is installed',
  secondaryActionLabel: 'Skip',
  title: 'Ship your first app',
};

export async function loadOnboardingPage(args: LoaderFunctionArgs): Promise<OnboardingPageData> {
  return await loadFirstDeployPageData(args);
}

export function OnboardingPage(): JSX.Element {
  return (
    <FirstDeployPage
      flowPathname={browserOnboardingPathname}
      headerCopy={onboardingHeaderCopy}
      hideBreadcrumbs={true}
    />
  );
}
