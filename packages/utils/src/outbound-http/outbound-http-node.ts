import {
  request as requestHttp,
  type ClientRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type RequestOptions,
} from 'node:http';
import { request as requestHttps } from 'node:https';
import { Readable } from 'node:stream';
import type { NormalizedOutboundHttpPolicy, NormalizedOutboundHttpRequest } from './outbound-http-client.types';
import { createPublicOutboundLookup } from './outbound-http-dns';
import { OutboundHttpPolicyError } from './outbound-http-error';
import { assertOutboundHttpUrlAllowed, normalizeDnsHostname } from './outbound-http-policy';
import { createResponseByteLimitReadableStream } from './outbound-http-response-body';

type NodeRequestFactory = typeof requestHttp;
type NodeRequestTimeout = NodeJS.Timeout;

interface PendingNodeOutboundRequest {
  clientRequest: ClientRequest | null;
  response: IncomingMessage | null;
  settled: boolean;
  timeout: NodeRequestTimeout | null;
}

export async function sendOutboundHttpRequest(
  url: URL,
  request: NormalizedOutboundHttpRequest,
  policy: NormalizedOutboundHttpPolicy,
): Promise<Response> {
  assertOutboundHttpUrlAllowed(url, policy);

  return await new Promise<Response>((resolve: (value: Response) => void, reject: (reason?: Error) => void): void => {
    const pending: PendingNodeOutboundRequest = createPendingNodeOutboundRequest(url, policy, reject);
    pending.clientRequest = createNodeClientRequest(url, request, policy, pending, resolve);
    pending.clientRequest.once('error', (error: Error): void => {
      rejectPendingNodeOutboundRequest(pending, reject, error);
    });
    writeNodeRequestBody(pending.clientRequest, request);
  });
}

function createNodeClientRequest(
  url: URL,
  request: NormalizedOutboundHttpRequest,
  policy: NormalizedOutboundHttpPolicy,
  pending: PendingNodeOutboundRequest,
  resolve: (value: Response) => void,
): ClientRequest {
  return readRequestFactory(url)(buildNodeRequestOptions(url, request, policy), (response: IncomingMessage): void => {
    pending.response = response;
    resolvePendingNodeOutboundRequest(
      pending,
      resolve,
      buildFetchResponse(url, response, policy, (): void => {
        clearPendingNodeOutboundRequestTimeout(pending);
      }),
    );
  });
}

function createPendingNodeOutboundRequest(
  url: URL,
  policy: NormalizedOutboundHttpPolicy,
  reject: (reason?: Error) => void,
): PendingNodeOutboundRequest {
  const pending: PendingNodeOutboundRequest = {
    clientRequest: null,
    response: null,
    settled: false,
    timeout: null,
  };
  pending.timeout = createNodeRequestDeadline(policy, (): void => {
    timeoutPendingNodeOutboundRequest(
      pending,
      reject,
      new Error(`Outbound HTTP request timed out for ${url.toString()}.`),
    );
  });

  return pending;
}

function readRequestFactory(url: URL): NodeRequestFactory {
  if (url.protocol === 'https:') {
    return requestHttps;
  }
  if (url.protocol === 'http:') {
    return requestHttp;
  }

  throw new OutboundHttpPolicyError(`Outbound HTTP protocol ${url.protocol} is not supported.`);
}

function buildNodeRequestOptions(
  url: URL,
  request: NormalizedOutboundHttpRequest,
  policy: NormalizedOutboundHttpPolicy,
): RequestOptions {
  return {
    headers: buildNodeRequestHeaders(request),
    hostname: normalizeDnsHostname(url.hostname),
    method: request.method,
    path: `${url.pathname}${url.search}`,
    protocol: url.protocol,
    ...(url.port === '' ? {} : { port: url.port }),
    ...(request.signal === undefined || request.signal === null ? {} : { signal: request.signal }),
    ...(policy.addressPolicy === 'public' ? { lookup: createPublicOutboundLookup(policy) } : {}),
  };
}

function buildNodeRequestHeaders(request: NormalizedOutboundHttpRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value: string, name: string): void => {
    headers[name] = value;
  });
  if (request.body !== undefined && headers['content-length'] === undefined) {
    headers['content-length'] = String(Buffer.byteLength(request.body));
  }

  return headers;
}

function createNodeRequestDeadline(
  policy: NormalizedOutboundHttpPolicy,
  onTimeout: () => void,
): NodeRequestTimeout | null {
  if (policy.timeoutMs === null) {
    return null;
  }

  return setTimeout(onTimeout, policy.timeoutMs);
}

function resolvePendingNodeOutboundRequest(
  pending: PendingNodeOutboundRequest,
  resolve: (value: Response) => void,
  response: Response,
): void {
  if (pending.settled) {
    return;
  }
  pending.settled = true;
  resolve(response);
}

function rejectPendingNodeOutboundRequest(
  pending: PendingNodeOutboundRequest,
  reject: (reason?: Error) => void,
  error: Error,
): void {
  if (pending.settled) {
    return;
  }
  pending.settled = true;
  clearPendingNodeOutboundRequestTimeout(pending);
  pending.response?.destroy(error);
  pending.clientRequest?.destroy(error);
  reject(error);
}

function timeoutPendingNodeOutboundRequest(
  pending: PendingNodeOutboundRequest,
  reject: (reason?: Error) => void,
  error: Error,
): void {
  clearPendingNodeOutboundRequestTimeout(pending);
  pending.response?.destroy(error);
  pending.clientRequest?.destroy(error);
  if (pending.settled) {
    return;
  }

  pending.settled = true;
  reject(error);
}

function clearPendingNodeOutboundRequestTimeout(pending: PendingNodeOutboundRequest): void {
  if (pending.timeout === null) {
    return;
  }

  clearTimeout(pending.timeout);
  pending.timeout = null;
}

function writeNodeRequestBody(clientRequest: ClientRequest, request: NormalizedOutboundHttpRequest): void {
  if (request.body === undefined) {
    clientRequest.end();
    return;
  }

  clientRequest.end(request.body);
}

function buildFetchResponse(
  url: URL,
  response: IncomingMessage,
  policy: NormalizedOutboundHttpPolicy,
  onBodyComplete: () => void,
): Response {
  const responseInit: ResponseInit = {
    headers: buildFetchResponseHeaders(response.headers),
    status: response.statusCode ?? 0,
    ...(response.statusMessage === undefined ? {} : { statusText: response.statusMessage }),
  };
  const responseBody: ReadableStream<Uint8Array> | null = isFetchNullBodyStatus(responseInit.status)
    ? null
    : createLimitedFetchResponseBody(response, policy, url, onBodyComplete);
  if (responseBody === null) {
    onBodyComplete();
    response.resume();
  }
  const fetchResponse: Response = new Response(responseBody, responseInit);
  Object.defineProperty(fetchResponse, 'url', {
    configurable: true,
    value: url.toString(),
  });

  return fetchResponse;
}

function createLimitedFetchResponseBody(
  response: IncomingMessage,
  policy: NormalizedOutboundHttpPolicy,
  url: URL,
  onBodyComplete: () => void,
): ReadableStream<Uint8Array> {
  return createResponseByteLimitReadableStream(
    Readable.toWeb(response) as ReadableStream<Uint8Array>,
    policy,
    url,
    onBodyComplete,
  );
}

function isFetchNullBodyStatus(statusCode: number | undefined): boolean {
  return statusCode === 204 || statusCode === 205 || statusCode === 304;
}

function buildFetchResponseHeaders(headers: IncomingHttpHeaders): Headers {
  const fetchHeaders: Headers = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    appendFetchResponseHeader(fetchHeaders, name, value);
  }

  return fetchHeaders;
}

function appendFetchResponseHeader(fetchHeaders: Headers, name: string, value: string | string[] | undefined): void {
  if (value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      fetchHeaders.append(name, item);
    }
    return;
  }

  fetchHeaders.set(name, value);
}
