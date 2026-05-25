import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import {
  browserLoginPathname,
  browserStartOnboardingSearchParamName,
  buildBrowserOrganizationOnboardingPathname,
} from '../../browser-public-paths';
import { authenticateBrowserCompartmentSession } from '../../services/app-access.service';
import type { BrowserCompartmentSession } from '../../services/app-access.service.types';
import { listSessionVisibleOrganizations } from '../../services/organizations.service';
import type { OrganizationSummaryInput } from '../../services/presenter.types';
import { readCompartmentSessionToken } from './browser-flow.helpers';
import { browserPageRateLimitRouteOptions } from './browser-page-rate-limit.route';
import {
  buildBrowserProjectsRedirectUrl,
  readSelectedBrowserSessionOrganizationSlug,
} from './browser-session-response.helpers';
import { sendAuthenticatedBrowserShell } from './browser-authenticated-shell.helpers';
import { renderBrowserProjectsPage } from './browser-projects.page';

export function registerBrowserHomeRoute(app: ApiApp): void {
  app.get('/', browserPageRateLimitRouteOptions, handleBrowserHome);
}

async function handleBrowserHome(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const url: URL = new URL(request.url, 'http://compartment.localhost');
  const session: BrowserCompartmentSession | null = await authenticateBrowserCompartmentSession(
    readCompartmentSessionToken(request),
  );

  if (session === null) {
    return await reply.redirect(buildBrowserHomeLoginPath(url.searchParams));
  }

  const selectedOrganizationSlug: string | null = await readBrowserHomeSelectedOrganizationSlug(session);
  if (selectedOrganizationSlug === null) {
    return await sendAuthenticatedBrowserShell(request, reply, renderBrowserProjectsPage);
  }

  return await reply.redirect(buildBrowserHomeRedirectUrl(selectedOrganizationSlug, url.searchParams));
}

async function readBrowserHomeSelectedOrganizationSlug(session: BrowserCompartmentSession): Promise<string | null> {
  const organizations: OrganizationSummaryInput[] = await listSessionVisibleOrganizations(session.authSession);
  if (session.authSession.organizationId === null) {
    return organizations.length === 1 ? organizations[0]!.slug : null;
  }

  return (
    readSelectedBrowserSessionOrganizationSlug({
      authSession: session.authSession,
      organizations,
    }) ?? null
  );
}

function buildBrowserHomeLoginPath(searchParams: URLSearchParams): string {
  const nextSearchParams: URLSearchParams = new URLSearchParams();
  if (searchParams.has(browserStartOnboardingSearchParamName)) {
    nextSearchParams.set(browserStartOnboardingSearchParamName, 'true');
  }

  const search: string = nextSearchParams.toString();
  return search === '' ? browserLoginPathname : `${browserLoginPathname}?${search}`;
}

function buildBrowserHomeRedirectUrl(selectedOrganizationSlug: string, searchParams: URLSearchParams): string {
  return searchParams.has(browserStartOnboardingSearchParamName)
    ? buildBrowserOrganizationOnboardingPathname(selectedOrganizationSlug)
    : buildBrowserProjectsRedirectUrl(selectedOrganizationSlug);
}
