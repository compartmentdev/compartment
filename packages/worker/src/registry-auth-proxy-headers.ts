import type { IncomingMessage } from 'node:http';
import { rewriteRegistryLocationHeader } from './registry-auth-proxy-location';

const hopByHopHeaderNames: ReadonlySet<string> = new Set<string>([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export function buildProxyRequestHeaders(request: IncomingMessage, targetUrl: URL): Record<string, string | string[]> {
  return {
    ...filterProxyHeaders(request.headers),
    host: targetUrl.host,
  };
}

export function buildProxyResponseHeaders(
  response: IncomingMessage,
  targetUrl: URL,
): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = filterProxyHeaders(response.headers);
  const location: string | string[] | undefined = headers.location;
  if (location !== undefined) {
    const rewrittenLocation: string | null =
      typeof location === 'string' ? rewriteRegistryLocationHeader(location, targetUrl) : null;
    if (rewrittenLocation === null) {
      delete headers.location;
    } else {
      headers.location = rewrittenLocation;
    }
  }

  return headers;
}

function filterProxyHeaders(headers: NodeJS.Dict<string | string[]>): Record<string, string | string[]> {
  const filteredHeaders: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && !hopByHopHeaderNames.has(name.toLowerCase()) && name.toLowerCase() !== 'authorization') {
      filteredHeaders[name] = value;
    }
  }

  return filteredHeaders;
}
