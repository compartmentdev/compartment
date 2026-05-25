import type { JSX } from 'react';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import type { BrowserConsoleOrganizationIssue } from '../../services/browser-organization-context.service.types';
import { BrowserConsoleOrganizationContextPanel } from '../console/console-organization-context-panel';
import { buildBrowserConsoleHref } from '../console/console-hrefs';
import type { OnboardingPageData } from './onboarding-page-data.types';

interface OnboardingOrganizationContextPanelProps {
  context: BrowserConsoleOrganizationIssue;
  data: OnboardingPageData;
  flowPathname: string;
}

export function OnboardingOrganizationContextPanel({
  context,
  data,
  flowPathname,
}: Readonly<OnboardingOrganizationContextPanelProps>): JSX.Element {
  return (
    <BrowserConsoleOrganizationContextPanel
      context={context}
      onNavigate={readOnboardingOrganizationNavigate()}
      organizations={data.organizations}
      readOrganizationHref={(organizationSlug: string): string =>
        appendFlowSearch(buildBrowserConsoleHref(flowPathname, organizationSlug), data.flowSearch)
      }
    />
  );
}

function readOnboardingOrganizationNavigate(): BrowserSoftNavigateHandler {
  return (href: string): void => {
    window.location.assign(href);
  };
}

function appendFlowSearch(href: string, flowSearch: string): string {
  return flowSearch === '' ? href : `${href}${flowSearch}`;
}
