import { appendOptionalSearchParam } from '@compartment/utils';

import { buildBrowserOrganizationScopedPathname } from '../../browser-public-paths';

interface BrowserProjectHrefSearchInput {
  environmentName: string | null;
  organizationSlug: string | null;
}

export function appendBrowserProjectHrefSearch(
  pathname: string,
  input: Readonly<BrowserProjectHrefSearchInput>,
): string {
  const searchParams: URLSearchParams = new URLSearchParams();
  appendOptionalSearchParam(searchParams, 'environmentName', input.environmentName ?? undefined);

  const search: string = searchParams.toString();
  const scopedPathname: string =
    input.organizationSlug === null
      ? pathname
      : buildBrowserOrganizationScopedPathname(input.organizationSlug, pathname);
  return search === '' ? scopedPathname : `${scopedPathname}?${search}`;
}
