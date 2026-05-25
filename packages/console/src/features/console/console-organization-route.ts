import type { OrganizationSummary } from '@compartment/contracts/browser';
import {
  browserSelectedOrganizationSearchParamName,
  buildBrowserOrganizationScopedPathname,
} from '../../browser-public-paths';
import type { BrowserConsoleOrganizationContext } from '../../services/browser-organization-context.service.types';

export interface BrowserConsoleRouteInput {
  pathname: string;
  searchParams: URLSearchParams;
}

export interface BrowserConsoleOrganizationRouteResolution {
  organizationContext: BrowserConsoleOrganizationContext;
  redirectTo: string | null;
}

export interface BrowserConsoleOrganizationRouteOptions {
  allowLegacyOrganizationQuery?: boolean;
}

export function readBrowserConsoleRouteInput(input: URL): BrowserConsoleRouteInput {
  return { pathname: input.pathname, searchParams: input.searchParams };
}

export function readBrowserConsoleOrganizationRouteResolution(
  routeInput: BrowserConsoleRouteInput,
  organizations: OrganizationSummary[],
  options: BrowserConsoleOrganizationRouteOptions = {},
): BrowserConsoleOrganizationRouteResolution {
  const pathOrganizationSlug: string | null = readBrowserConsolePathOrganizationSlug(routeInput.pathname);
  const queryOrganizationSlug: string | null = readBrowserConsoleQueryOrganizationSlug(routeInput, options);
  const redirectTo: string | null = readBrowserConsoleOrganizationRouteRedirect(
    routeInput,
    organizations,
    pathOrganizationSlug,
    queryOrganizationSlug,
  );
  const requestedOrganizationSlug: string | null = readBrowserConsoleRequestedOrganizationSlug(routeInput, options);

  return {
    organizationContext:
      requestedOrganizationSlug === null
        ? readMissingBrowserConsoleOrganizationContext()
        : readRequestedBrowserConsoleOrganizationContext(requestedOrganizationSlug, organizations),
    redirectTo,
  };
}

export function readBrowserConsoleRequestedOrganizationSlug(
  routeInput: BrowserConsoleRouteInput,
  options: BrowserConsoleOrganizationRouteOptions = {},
): string | null {
  return (
    readBrowserConsolePathOrganizationSlug(routeInput.pathname) ??
    readBrowserConsoleQueryOrganizationSlug(routeInput, options)
  );
}

function readBrowserConsoleQueryOrganizationSlug(
  routeInput: BrowserConsoleRouteInput,
  options: BrowserConsoleOrganizationRouteOptions,
): string | null {
  return options.allowLegacyOrganizationQuery === false
    ? null
    : routeInput.searchParams.get(browserSelectedOrganizationSearchParamName);
}

function readBrowserConsoleOrganizationRouteRedirect(
  routeInput: BrowserConsoleRouteInput,
  organizations: OrganizationSummary[],
  pathOrganizationSlug: string | null,
  queryOrganizationSlug: string | null,
): string | null {
  if (pathOrganizationSlug !== null) {
    return readBrowserConsolePathRouteRedirect(routeInput.pathname, routeInput.searchParams, queryOrganizationSlug);
  }

  return readBrowserConsoleBareRouteRedirect(
    routeInput.pathname,
    routeInput.searchParams,
    organizations,
    queryOrganizationSlug,
  );
}

function readBrowserConsolePathRouteRedirect(
  pathname: string,
  searchParams: URLSearchParams,
  queryOrganizationSlug: string | null,
): string | null {
  return queryOrganizationSlug === null ? null : buildBrowserConsoleRouteHref(pathname, searchParams);
}

function readBrowserConsoleBareRouteRedirect(
  pathname: string,
  searchParams: URLSearchParams,
  organizations: OrganizationSummary[],
  queryOrganizationSlug: string | null,
): string | null {
  if (queryOrganizationSlug !== null) {
    return buildBrowserConsoleRouteHref(
      buildBrowserOrganizationScopedPathname(queryOrganizationSlug, pathname),
      searchParams,
    );
  }

  return organizations.length === 1
    ? buildBrowserConsoleRouteHref(
        buildBrowserOrganizationScopedPathname(organizations[0]!.slug, pathname),
        searchParams,
      )
    : null;
}

function readBrowserConsolePathOrganizationSlug(pathname: string): string | null {
  const [, prefix, organizationSlug] = pathname.split('/');
  return prefix === 'orgs' && organizationSlug !== undefined ? decodeBrowserConsolePathSegment(organizationSlug) : null;
}

function decodeBrowserConsolePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function buildBrowserConsoleRouteHref(pathname: string, searchParams: URLSearchParams): string {
  const nextSearchParams: URLSearchParams = new URLSearchParams(searchParams);
  nextSearchParams.delete(browserSelectedOrganizationSearchParamName);

  const search: string = nextSearchParams.toString();
  return search === '' ? pathname : `${pathname}?${search}`;
}

function readMissingBrowserConsoleOrganizationContext(): BrowserConsoleOrganizationContext {
  return {
    kind: 'organization_required',
    requestedOrganizationSlug: null,
    selectedOrganizationSlug: null,
  };
}

function readRequestedBrowserConsoleOrganizationContext(
  requestedOrganizationSlug: string,
  organizations: OrganizationSummary[],
): BrowserConsoleOrganizationContext {
  return organizations.some(
    (organization: OrganizationSummary): boolean => organization.slug === requestedOrganizationSlug,
  )
    ? { kind: 'selected', selectedOrganizationSlug: requestedOrganizationSlug }
    : {
        kind: 'organization_unavailable',
        requestedOrganizationSlug,
        selectedOrganizationSlug: null,
      };
}
