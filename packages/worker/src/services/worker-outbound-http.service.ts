import {
  createOutboundHttpFetch,
  fetchOutboundHttp,
  normalizeOutboundTrustedHost,
  type OutboundHttpResource,
} from '@compartment/utils';
import { readWorkerTrustedOutboundHosts } from '../config';
import type { WorkerArtifactRegistryConfig } from '../worker-artifact-registry.types';

const builtInTrustedPublicOutboundHosts: readonly string[] = ['api.github.com', 'codeload.github.com'];
const gitHubTrustedOutboundMaxRedirects: number = 5;

export function createWorkerGitHubTrustedOutboundFetch(): typeof fetch {
  return createOutboundHttpFetch({
    addressPolicy: 'public',
    allowedProtocols: ['https:'],
    maxRedirects: gitHubTrustedOutboundMaxRedirects,
    trustedHosts: readWorkerTrustedPublicOutboundHosts(),
  });
}

export function createWorkerGitHubArchiveTrustedOutboundFetch(): typeof fetch {
  return createOutboundHttpFetch({
    addressPolicy: 'public',
    allowedProtocols: ['https:'],
    maxResponseBytes: null,
    maxRedirects: gitHubTrustedOutboundMaxRedirects,
    trustedHosts: readWorkerTrustedPublicOutboundHosts(),
  });
}

export async function fetchWorkerArtifactRegistryInternalHttp(
  artifactRegistry: WorkerArtifactRegistryConfig,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return await fetchConfiguredInternalOutboundHttp(
    buildConfiguredInternalUrl(artifactRegistry.internalUrl, path),
    init,
  );
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

function readWorkerTrustedPublicOutboundHosts(): string[] {
  return [...builtInTrustedPublicOutboundHosts, ...readWorkerTrustedOutboundHosts()].map(normalizeOutboundTrustedHost);
}

function buildConfiguredInternalUrl(baseUrl: string, path: string): URL {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error('Configured internal outbound HTTP paths must start with a single slash.');
  }

  return new URL(path, baseUrl);
}
