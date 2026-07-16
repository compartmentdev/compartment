import {
  compartmentBrowserLoginPathname,
  compartmentBrowserStartOnboardingSearchParamName,
} from '@compartment/contracts/browser';

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

function appendFlagSearchParam(url: URL, name: string): string {
  const prefix: string = url.search === '' ? '?' : '&';

  return `${url.toString()}${prefix}${encodeURIComponent(name)}`;
}
