import {
  browserHomePathname,
  browserLoginSuccessRedirectSearchParamName,
  browserLoginSsoPathname,
  browserOnboardingPathname,
  browserProjectCreatePathname,
  browserProjectsPathname,
  browserStartOnboardingSearchParamName,
  buildBrowserOrganizationOnboardingPathname,
  buildBrowserOrganizationScopedPathname,
} from '../../browser-public-paths';

const browserLoginSuccessRedirectStorageKey: string = 'compartment.login.successRedirectTo';
const browserLoginUrlBase: string = 'http://compartment.localhost';
const browserLoginUrlOrigin: string = new URL(browserLoginUrlBase).origin;

export function readLoginSuccessRedirectTo(redirectTo: string, successRedirectTo: string | undefined): string {
  const browserSuccessRedirectTo: string | undefined = readBrowserLoginSuccessRedirect(successRedirectTo ?? null);
  if (browserSuccessRedirectTo === undefined) {
    return redirectTo;
  }

  const redirectOrganizationSlug: string | null | undefined = readBrowserConsoleRedirectOrganizationSlug(redirectTo);
  if (redirectOrganizationSlug === undefined) {
    return redirectTo;
  }

  if (isOrganizationScopedLoginSuccessRedirect(browserSuccessRedirectTo)) {
    return browserSuccessRedirectTo;
  }

  return redirectOrganizationSlug === null
    ? readUnscopedLoginSuccessRedirect(browserSuccessRedirectTo)
    : readOrganizationScopedLoginSuccessRedirect(browserSuccessRedirectTo, redirectOrganizationSlug);
}

export function readLoginSsoRedirectUrl(loginUrl: string, successRedirectTo: string | undefined): string {
  const browserSuccessRedirectTo: string | undefined = readBrowserLoginSuccessRedirect(successRedirectTo ?? null);
  if (browserSuccessRedirectTo === undefined) {
    return loginUrl;
  }

  const url: URL = new URL(loginUrl, browserLoginUrlBase);
  if (readBrowserLoginSuccessRedirectPathname(browserSuccessRedirectTo) === browserOnboardingPathname) {
    url.searchParams.set(browserStartOnboardingSearchParamName, 'true');
  } else {
    url.searchParams.set(browserLoginSuccessRedirectSearchParamName, browserSuccessRedirectTo);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function rememberBrowserLoginSuccessRedirect(successRedirectTo: string | undefined): void {
  const browserSuccessRedirectTo: string | undefined = readBrowserLoginSuccessRedirect(successRedirectTo ?? null);
  if (browserSuccessRedirectTo === undefined) {
    return;
  }

  try {
    window.sessionStorage.setItem(browserLoginSuccessRedirectStorageKey, browserSuccessRedirectTo);
  } catch {
    return;
  }
}

export function consumeBrowserLoginSuccessRedirect(): string | undefined {
  try {
    const successRedirectTo: string | null = window.sessionStorage.getItem(browserLoginSuccessRedirectStorageKey);
    clearBrowserLoginSuccessRedirect();
    return readBrowserLoginSuccessRedirect(successRedirectTo);
  } catch {
    return undefined;
  }
}

export function clearBrowserLoginSuccessRedirect(): void {
  try {
    window.sessionStorage.removeItem(browserLoginSuccessRedirectStorageKey);
  } catch {
    return;
  }
}

export function isBrowserSsoLoginUrl(value: string): boolean {
  return new URL(value, browserLoginUrlBase).pathname === browserLoginSsoPathname;
}

export function readBrowserLoginSuccessRedirect(value: string | null): string | undefined {
  if (value === null) {
    return undefined;
  }

  const url: URL | undefined = readBrowserLoginSuccessRedirectUrl(value);
  return url === undefined ? undefined : `${url.pathname}${url.search}${url.hash}`;
}

function readBrowserLoginSuccessRedirectUrl(value: string | undefined): URL | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!value.startsWith('/') || value.startsWith('//')) {
    return undefined;
  }

  try {
    const url: URL = new URL(value, browserLoginUrlBase);
    if (url.origin !== browserLoginUrlOrigin) {
      return undefined;
    }

    return isAllowedBrowserLoginSuccessRedirectPathname(url.pathname) ? url : undefined;
  } catch {
    return undefined;
  }
}

function readBrowserConsoleRedirectOrganizationSlug(value: string): string | null | undefined {
  const pathname: string = new URL(value, browserLoginUrlBase).pathname;
  if (pathname === browserHomePathname || pathname === browserProjectsPathname) {
    return null;
  }

  const [, prefix, , projectsSegment] = pathname.split('/');
  if (prefix !== 'orgs' || projectsSegment !== 'projects') {
    return undefined;
  }

  return decodeBrowserPathSegment(pathname.split('/')[2]!);
}

function isOrganizationScopedLoginSuccessRedirect(value: string): boolean {
  try {
    return isOrganizationScopedPath(new URL(value, browserLoginUrlBase).pathname);
  } catch {
    return false;
  }
}

function isAllowedBrowserLoginSuccessRedirectPathname(pathname: string): boolean {
  return (
    pathname === browserOnboardingPathname ||
    pathname === browserProjectCreatePathname ||
    isOrganizationScopedPath(pathname)
  );
}

function isOrganizationScopedPath(pathname: string): boolean {
  return /^\/orgs\/[^/]+(?:\/onboarding|\/projects\/create)$/.test(pathname);
}

function readUnscopedLoginSuccessRedirect(successRedirectTo: string): string {
  return readBrowserLoginSuccessRedirectPathname(successRedirectTo) === browserOnboardingPathname
    ? buildBrowserOnboardingChooserPath()
    : successRedirectTo;
}

function readOrganizationScopedLoginSuccessRedirect(successRedirectTo: string, organizationSlug: string): string {
  return readBrowserLoginSuccessRedirectPathname(successRedirectTo) === browserOnboardingPathname
    ? buildBrowserOrganizationOnboardingPathname(organizationSlug)
    : buildOrganizationScopedLoginSuccessRedirect(successRedirectTo, organizationSlug);
}

function buildOrganizationScopedLoginSuccessRedirect(successRedirectTo: string, organizationSlug: string): string {
  const url: URL = new URL(successRedirectTo, browserLoginUrlBase);
  return `${buildBrowserOrganizationScopedPathname(organizationSlug, url.pathname)}${url.search}${url.hash}`;
}

function buildBrowserOnboardingChooserPath(): string {
  return `${browserHomePathname}?${browserStartOnboardingSearchParamName}=true`;
}

function readBrowserLoginSuccessRedirectPathname(value: string): string {
  return new URL(value, browserLoginUrlBase).pathname;
}

function decodeBrowserPathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
