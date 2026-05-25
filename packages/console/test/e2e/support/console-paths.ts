export function isConsolePathname(url: URL, pathname: string): boolean {
  return url.pathname === pathname || readOrganizationScopedPathname(url.pathname) === pathname;
}

export function buildOrganizationScopedConsolePath(currentUrl: string, pathname: string): string {
  return `/orgs/${encodeURIComponent(readCurrentConsoleOrganizationSlug(currentUrl))}${pathname}`;
}

function readOrganizationScopedPathname(pathname: string): string | null {
  const [, prefix, organizationSlug, ...segments] = pathname.split('/');
  if (prefix !== 'orgs' || organizationSlug === undefined || organizationSlug === '' || segments.length === 0) {
    return null;
  }

  return `/${segments.join('/')}`;
}

function readCurrentConsoleOrganizationSlug(currentUrl: string): string {
  const [, prefix, organizationSlug] = new URL(currentUrl).pathname.split('/');
  if (prefix !== 'orgs' || organizationSlug === undefined || organizationSlug === '') {
    throw new Error(`Expected an organization-scoped console URL, received "${currentUrl}".`);
  }

  return decodeURIComponent(organizationSlug);
}
