import { redirect, type LoaderFunctionArgs } from 'react-router';
import { BrowserRedirect } from '../../lib/browser-redirect';
import { loadBrowserConsoleContext, type BrowserConsoleContext } from '../console/console-data';
import { buildBrowserConsoleProjectsHref } from '../console/console-hrefs';
import type { OnboardingPageData } from './onboarding-page-data.types';

export async function loadFirstDeployPageData({ request }: LoaderFunctionArgs): Promise<OnboardingPageData> {
  const url: URL = new URL(request.url);
  try {
    const context: BrowserConsoleContext = await readFirstDeployConsoleContext(url);
    return {
      flowSearch: url.search,
      organizationContext: context.organizationContext,
      organizations: context.organizations,
      principalEmail: context.principalEmail,
      projectsHref: buildFirstDeployProjectsHref(context),
      selectedOrganizationSlug: context.selectedOrganizationSlug,
      showOrganizationSelector: context.showOrganizationSelector,
    };
  } catch (error) {
    if (error instanceof BrowserRedirect) {
      return redirect(error.to) as never;
    }

    throw error;
  }
}

async function readFirstDeployConsoleContext(url: URL): Promise<BrowserConsoleContext> {
  return await loadBrowserConsoleContext(url, {}, { allowLegacyOrganizationQuery: false });
}

function buildFirstDeployProjectsHref(context: BrowserConsoleContext): string {
  return buildBrowserConsoleProjectsHref(readFirstDeployProjectsOrganizationSlug(context));
}

function readFirstDeployProjectsOrganizationSlug(context: BrowserConsoleContext): string | null {
  return (
    context.selectedOrganizationSlug ??
    (context.organizationContext.kind === 'organization_unavailable'
      ? context.organizationContext.requestedOrganizationSlug
      : null)
  );
}
