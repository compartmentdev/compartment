import {
  buildGitHubApiBaseUrl,
  buildGitLabApiBaseUrl,
  createOutboundHttpFetch,
  fetchOutboundHttp,
  normalizeOutboundTrustedHost,
  type OutboundHttpResource,
} from '@compartment/utils';
import { getApiConfig } from '../runtime/runtime-access';

const builtInTrustedPublicOutboundHosts: readonly string[] = [
  'api.github.com',
  'gitlab.com',
  'accounts.google.com',
  'graph.microsoft.com',
  'login.microsoftonline.com',
  'oauth2.googleapis.com',
  'openidconnect.googleapis.com',
  'www.googleapis.com',
];
const gitHubTrustedOutboundMaxRedirects: number = 5;
const oidcTrustedOutboundMaxRedirects: number = 5;

export const createGitHubTrustedOutboundFetch: () => typeof fetch = createGitProviderTrustedOutboundFetch;
export const createGitLabTrustedOutboundFetch: () => typeof fetch = createGitProviderTrustedOutboundFetch;

function createGitProviderTrustedOutboundFetch(): typeof fetch {
  return createOutboundHttpFetch({
    addressPolicy: 'public',
    allowedProtocols: ['https:'],
    maxRedirects: gitHubTrustedOutboundMaxRedirects,
    trustedHosts: readTrustedPublicOutboundHosts(),
  });
}

export function createOidcTrustedOutboundFetch(): typeof fetch {
  return createOutboundHttpFetch({
    addressPolicy: 'public',
    allowedProtocols: ['https:'],
    maxRedirects: oidcTrustedOutboundMaxRedirects,
    trustedHosts: readTrustedPublicOutboundHosts(),
  });
}

export async function fetchSystemDomainProbeHttp(
  resource: OutboundHttpResource,
  init?: RequestInit,
): Promise<Response> {
  return await fetchOutboundHttp(resource, init, {
    addressPolicy: 'public',
    allowedProtocols: ['http:', 'https:'],
  });
}

export async function fetchEdgeInternalHttp(path: string, init?: RequestInit): Promise<Response> {
  return await fetchConfiguredInternalOutboundHttp(buildConfiguredInternalUrl(getApiConfig().edgeUrl, path), init);
}

export async function fetchGitHubAccountDiscoveryBrokerHttp(path: string, init?: RequestInit): Promise<Response> {
  const brokerUrl: string | null = getApiConfig().managedDomainBrokerUrl ?? null;
  if (brokerUrl === null) {
    throw new Error('GitHub account discovery broker URL is not configured.');
  }

  return await fetchConfiguredInternalOutboundHttp(buildConfiguredInternalUrl(brokerUrl, path), init);
}

export function isTrustedGitHubProviderHost(providerHost: string): boolean {
  return isTrustedPublicOutboundHost(new URL(buildGitHubApiBaseUrl(providerHost)).host);
}

export function isTrustedGitLabProviderHost(providerHost: string): boolean {
  return isTrustedPublicOutboundHost(new URL(buildGitLabApiBaseUrl(providerHost)).host);
}

export function isTrustedPublicOutboundHost(host: string): boolean {
  return readTrustedPublicOutboundHosts().includes(normalizeOutboundTrustedHost(host));
}

async function fetchConfiguredInternalOutboundHttp(
  resource: OutboundHttpResource,
  init: RequestInit | undefined,
): Promise<Response> {
  return await fetchOutboundHttp(resource, init, {
    addressPolicy: 'internal',
    allowedProtocols: ['http:', 'https:'],
  });
}

function readTrustedPublicOutboundHosts(): string[] {
  return [...builtInTrustedPublicOutboundHosts, ...getApiConfig().trustedOutboundHosts].map(
    normalizeOutboundTrustedHost,
  );
}

function buildConfiguredInternalUrl(baseUrl: string, path: string): URL {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error('Configured internal outbound HTTP paths must start with a single slash.');
  }

  return new URL(path, baseUrl);
}
