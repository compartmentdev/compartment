import {
  compartmentBrowserLoginPathname,
  compartmentBrowserStartOnboardingSearchParamName,
} from '@compartment/contracts';

interface CompartmentBrowserEntryUrlOptions {
  startOnboarding?: boolean | undefined;
}

export function buildCompartmentBrowserEntryUrl(
  compartmentUrl: string,
  email?: string,
  options: CompartmentBrowserEntryUrlOptions = {},
): string {
  const url: URL = new URL(compartmentBrowserLoginPathname, `${compartmentUrl}/`);
  if (email !== undefined) {
    url.searchParams.set('email', email);
  }

  return options.startOnboarding === true
    ? appendFlagSearchParam(url, compartmentBrowserStartOnboardingSearchParamName)
    : url.toString();
}

export function buildControlPlaneUrl(publicScheme: 'http' | 'https', host: string, port: number): string {
  const defaultPort: number = publicScheme === 'http' ? 80 : 443;
  if (port === defaultPort) {
    return `${publicScheme}://${host}`;
  }

  return `${publicScheme}://${host}:${port.toString()}`;
}

function appendFlagSearchParam(url: URL, name: string): string {
  const prefix: string = url.search === '' ? '?' : '&';

  return `${url.toString()}${prefix}${encodeURIComponent(name)}`;
}
