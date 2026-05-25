import type {
  CreateOutboundHttpFetchInput,
  NormalizedOutboundHttpPolicy,
  NormalizedOutboundHttpRequest,
  OutboundHttpResource,
} from './outbound-http-client.types';
import { OutboundHttpPolicyError } from './outbound-http-error';
import { sendOutboundHttpRequest } from './outbound-http-node';
import { assertOutboundHttpUrlAllowed, normalizeOutboundHttpPolicy } from './outbound-http-policy';
import { buildRedirectRequestInit, normalizeOutboundHttpRequest, readOutboundHttpUrl } from './outbound-http-request';

const redirectStatusCodes: ReadonlySet<number> = new Set<number>([301, 302, 303, 307, 308]);

interface OutboundHttpRequestResult {
  request: NormalizedOutboundHttpRequest;
  response: Response;
  url: URL;
}

interface OutboundHttpRedirectTarget {
  init: RequestInit;
  url: URL;
}

export async function fetchOutboundHttp(
  resource: OutboundHttpResource,
  init: RequestInit | undefined,
  input: CreateOutboundHttpFetchInput,
): Promise<Response> {
  return await createOutboundHttpFetch(input)(resource, init);
}

export function createOutboundHttpFetch(input: CreateOutboundHttpFetchInput): typeof fetch {
  const policy: NormalizedOutboundHttpPolicy = normalizeOutboundHttpPolicy(input);
  const outboundFetch: typeof fetch = async (resource: OutboundHttpResource, init?: RequestInit): Promise<Response> => {
    return await fetchOutboundHttpWithRedirects(resource, init, policy);
  };

  return outboundFetch;
}

async function fetchOutboundHttpWithRedirects(
  resource: OutboundHttpResource,
  init: RequestInit | undefined,
  policy: NormalizedOutboundHttpPolicy,
): Promise<Response> {
  let currentResource: OutboundHttpResource = resource;
  let currentInit: RequestInit | undefined = init;
  for (let redirectCount: number = 0; ; redirectCount += 1) {
    const result: OutboundHttpRequestResult = await sendCurrentOutboundHttpRequest(
      currentResource,
      currentInit,
      policy,
    );
    const redirectTarget: OutboundHttpRedirectTarget | null = await readOutboundHttpRedirectTarget(
      result,
      policy,
      redirectCount,
    );
    if (redirectTarget === null) {
      return result.response;
    }

    currentResource = redirectTarget.url;
    currentInit = redirectTarget.init;
  }
}

async function readOutboundHttpRedirectTarget(
  result: OutboundHttpRequestResult,
  policy: NormalizedOutboundHttpPolicy,
  redirectCount: number,
): Promise<OutboundHttpRedirectTarget | null> {
  if (!shouldFollowRedirect(result.response, result.request)) {
    return null;
  }

  const nextUrl: URL | null = readRedirectUrl(result.response, result.url);
  if (nextUrl === null) {
    return null;
  }
  assertRedirectLimit(result.url, policy, redirectCount);
  await cancelRedirectResponseBody(result.response);

  return {
    init: buildRedirectRequestInit(result.request, result.response.status, result.url, nextUrl),
    url: nextUrl,
  };
}

async function sendCurrentOutboundHttpRequest(
  resource: OutboundHttpResource,
  init: RequestInit | undefined,
  policy: NormalizedOutboundHttpPolicy,
): Promise<OutboundHttpRequestResult> {
  const url: URL = readOutboundHttpUrl(resource);
  assertOutboundHttpUrlAllowed(url, policy);
  const request: NormalizedOutboundHttpRequest = await normalizeOutboundHttpRequest(resource, init);
  const response: Response = await sendOutboundHttpRequest(url, request, policy);

  return { request, response, url };
}

function shouldFollowRedirect(response: Response, request: NormalizedOutboundHttpRequest): boolean {
  if (!redirectStatusCodes.has(response.status) || request.redirect === 'manual') {
    return false;
  }
  if (request.redirect === 'error') {
    throw new OutboundHttpPolicyError('Outbound HTTP redirect is not allowed.');
  }

  return true;
}

function readRedirectUrl(response: Response, url: URL): URL | null {
  const location: string | null = response.headers.get('location');
  return location === null ? null : new URL(location, url);
}

function assertRedirectLimit(url: URL, policy: NormalizedOutboundHttpPolicy, redirectCount: number): void {
  if (redirectCount >= policy.maxRedirects) {
    throw new OutboundHttpPolicyError(`Outbound HTTP redirect limit exceeded for ${url.toString()}.`);
  }
}

async function cancelRedirectResponseBody(response: Response): Promise<void> {
  if (response.body === null) {
    return;
  }

  await response.body.cancel();
}
