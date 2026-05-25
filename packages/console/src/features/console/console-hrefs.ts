import {
  browserHomePathname,
  browserOnboardingPathname,
  browserProjectsPathname,
  browserStartOnboardingSearchParamName,
  buildBrowserOrganizationScopedPathname,
} from '../../browser-public-paths';

interface BrowserConsoleHrefParam {
  name: string;
  value: string;
}

export function buildBrowserConsoleProjectsHref(
  selectedOrganizationSlug: string | null,
  params: BrowserConsoleHrefParam[] = [],
): string {
  return buildBrowserConsoleHref(browserProjectsPathname, selectedOrganizationSlug, params);
}

export function buildBrowserConsoleHref(
  pathname: string,
  selectedOrganizationSlug: string | null,
  params: BrowserConsoleHrefParam[] = [],
): string {
  const searchParams: URLSearchParams = new URLSearchParams();
  params.forEach((param: BrowserConsoleHrefParam): void => {
    searchParams.set(param.name, param.value);
  });

  const query: string = searchParams.toString();
  const scopedPathname: string = readBrowserConsoleHrefPathname(pathname, selectedOrganizationSlug, searchParams);
  return query === '' ? scopedPathname : `${scopedPathname}?${query}`;
}

function readBrowserConsoleHrefPathname(
  pathname: string,
  selectedOrganizationSlug: string | null,
  searchParams: URLSearchParams,
): string {
  if (selectedOrganizationSlug !== null) {
    return buildBrowserOrganizationScopedPathname(selectedOrganizationSlug, pathname);
  }

  if (pathname === browserOnboardingPathname) {
    searchParams.set(browserStartOnboardingSearchParamName, 'true');
  }

  return browserHomePathname;
}
