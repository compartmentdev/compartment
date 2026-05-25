import type { NormalizedOutboundHttpRequest, OutboundHttpResource } from './outbound-http-client.types';
import { OutboundHttpPolicyError } from './outbound-http-error';

export async function normalizeOutboundHttpRequest(
  resource: OutboundHttpResource,
  init: RequestInit | undefined,
): Promise<NormalizedOutboundHttpRequest> {
  const request: Request = createOutboundRequest(resource, init);
  const body: Buffer | undefined = await readOutboundRequestBody(request);

  return {
    ...(body === undefined ? {} : { body }),
    headers: new Headers(request.headers),
    method: request.method.toUpperCase(),
    redirect: request.redirect,
    signal: request.signal,
  };
}

export function buildRedirectRequestInit(
  previousRequest: NormalizedOutboundHttpRequest,
  statusCode: number,
  previousUrl: URL,
  nextUrl: URL,
): RequestInit {
  const headers: Headers = new Headers(previousRequest.headers);
  const redirectsWithGet: boolean = shouldRedirectWithGet(statusCode, previousRequest.method);
  if (previousUrl.origin !== nextUrl.origin) {
    if (!redirectsWithGet && previousRequest.body !== undefined) {
      throw new OutboundHttpPolicyError('Outbound HTTP cross-origin redirect with request body is not allowed.');
    }
    headers.delete('authorization');
    headers.delete('cookie');
  }
  if (redirectsWithGet) {
    return buildRedirectGetRequestInit(previousRequest, headers);
  }

  return buildRedirectPreservedRequestInit(previousRequest, headers);
}

function createOutboundRequest(resource: OutboundHttpResource, init: RequestInit | undefined): Request {
  if (isRequest(resource)) {
    return new Request(resource, init);
  }

  return new Request(readOutboundHttpUrl(resource).toString(), init);
}

export function readOutboundHttpUrl(resource: OutboundHttpResource): URL {
  if (resource instanceof URL) {
    return resource;
  }
  if (isRequest(resource)) {
    return new URL(resource.url);
  }
  if (typeof resource === 'string') {
    return new URL(resource);
  }

  throw new TypeError('Outbound HTTP resource must be a URL, string, or Request.');
}

async function readOutboundRequestBody(request: Request): Promise<Buffer | undefined> {
  if (request.body === null) {
    return undefined;
  }

  return Buffer.from(await request.arrayBuffer());
}

function isRequest(resource: OutboundHttpResource): resource is Request {
  return typeof Request !== 'undefined' && resource instanceof Request;
}

function buildRedirectGetRequestInit(previousRequest: NormalizedOutboundHttpRequest, headers: Headers): RequestInit {
  headers.delete('content-length');
  headers.delete('content-type');

  return {
    headers,
    method: 'GET',
    redirect: previousRequest.redirect,
    ...(previousRequest.signal === undefined || previousRequest.signal === null
      ? {}
      : { signal: previousRequest.signal }),
  };
}

function buildRedirectPreservedRequestInit(
  previousRequest: NormalizedOutboundHttpRequest,
  headers: Headers,
): RequestInit {
  return {
    ...(previousRequest.body === undefined ? {} : { body: previousRequest.body }),
    headers,
    method: previousRequest.method,
    redirect: previousRequest.redirect,
    ...(previousRequest.signal === undefined || previousRequest.signal === null
      ? {}
      : { signal: previousRequest.signal }),
  };
}

function shouldRedirectWithGet(statusCode: number, method: string): boolean {
  return statusCode === 303 || ((statusCode === 301 || statusCode === 302) && method !== 'GET' && method !== 'HEAD');
}
