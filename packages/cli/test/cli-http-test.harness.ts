import {
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
  type RequestOptions as HttpRequestOptions,
} from 'node:http';
import { request as httpsRequest, type RequestOptions as HttpsRequestOptions } from 'node:https';
import { readCookieValue } from '@compartment/utils';

export interface CliHttpTextRequestOptions {
  readonly body?: Buffer | Uint8Array | string | undefined;
  readonly headers?: Record<string, string> | undefined;
  readonly method?: string | undefined;
  readonly requestPath?: string | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface CliHttpTextResponse {
  readonly body: string;
  readonly headers: Record<string, string>;
  readonly statusCode: number;
}

export async function sendCliHttpTextRequest(
  url: string,
  options: CliHttpTextRequestOptions = {},
): Promise<CliHttpTextResponse> {
  const targetUrl: URL = new URL(url);
  const requestUrl: URL = buildCliHttpRequestUrl(targetUrl);
  const requestHeaders: Record<string, string> = buildCliHttpRequestHeaders(targetUrl, requestUrl, options.headers);
  const requestPath: string = options.requestPath ?? `${requestUrl.pathname}${requestUrl.search}`;
  const timeoutMs: number = options.timeoutMs ?? cliHttpTextRequestTimeoutMs;

  return await new Promise<CliHttpTextResponse>(
    (resolveRequest: (value: CliHttpTextResponse) => void, rejectRequest: (reason?: Error) => void): void => {
      const request: ClientRequest = sendCliHttpRequest(
        targetUrl,
        requestUrl,
        requestPath,
        requestHeaders,
        options.method,
        (response: IncomingMessage): void => readCliHttpResponse(response, resolveRequest, rejectRequest),
      );
      request.setTimeout(timeoutMs, (): void => {
        request.destroy(buildCliHttpRequestTimeoutError(targetUrl, timeoutMs));
      });
      request.on('error', rejectRequest);
      request.end(options.body);
    },
  );
}

export function readCliHttpSetCookieValue(setCookieHeader: string | undefined, cookieName: string): string {
  const cookieValue: string | undefined = readCookieValue(setCookieHeader, cookieName);
  if (cookieValue === undefined || cookieValue === '') {
    throw new Error(`Expected cookie "${cookieName}" in Set-Cookie header.`);
  }

  return cookieValue;
}

function buildCliHttpRequestUrl(targetUrl: URL): URL {
  if (!targetUrl.hostname.endsWith('.localhost')) {
    return targetUrl;
  }

  const requestUrl: URL = new URL(targetUrl.toString());
  requestUrl.hostname = '127.0.0.1';

  return requestUrl;
}

function buildCliHttpRequestHeaders(
  targetUrl: URL,
  requestUrl: URL,
  extraHeaders: Record<string, string> = {},
): Record<string, string> {
  return targetUrl.host === requestUrl.host ? extraHeaders : { ...extraHeaders, host: targetUrl.host };
}

function sendCliHttpRequest(
  targetUrl: URL,
  requestUrl: URL,
  requestPath: string,
  requestHeaders: Record<string, string>,
  method: string | undefined,
  handleResponse: (response: IncomingMessage) => void,
): ClientRequest {
  const requestOptions: HttpRequestOptions = {
    headers: requestHeaders,
    hostname: requestUrl.hostname,
    method: method ?? 'GET',
    path: requestPath,
    port: requestUrl.port === '' ? undefined : Number.parseInt(requestUrl.port, 10),
    protocol: requestUrl.protocol,
  };

  if (requestUrl.protocol !== 'https:') {
    return httpRequest(requestOptions, handleResponse);
  }

  return httpsRequest(
    {
      ...requestOptions,
      rejectUnauthorized: !isLocalBrowserIngressHost(targetUrl.hostname),
      servername: targetUrl.hostname,
    } satisfies HttpsRequestOptions,
    handleResponse,
  );
}

function isLocalBrowserIngressHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1.sslip.io' ||
    hostname.endsWith('.127.0.0.1.sslip.io')
  );
}

const cliHttpTextRequestTimeoutMs: number = 5_000;

function readCliHttpResponse(
  response: IncomingMessage,
  resolveRequest: (value: CliHttpTextResponse) => void,
  rejectRequest: (reason?: Error) => void,
): void {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer | string): void => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  response.on('error', rejectRequest);
  response.on('end', (): void => {
    resolveRequest({
      body: Buffer.concat(chunks).toString('utf8'),
      headers: readCliHttpResponseHeaders(response.headers),
      statusCode: response.statusCode ?? 0,
    });
  });
}

function buildCliHttpRequestTimeoutError(targetUrl: URL, timeoutMs: number): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(
    `HTTP request to ${targetUrl.toString()} timed out after ${timeoutMs.toString()}ms.`,
  );
  error.code = 'ETIMEDOUT';

  return error;
}

function readCliHttpResponseHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).flatMap(([name, value]: [string, string | string[] | undefined]): [string, string][] => {
      if (typeof value === 'string') {
        return [[name, value]];
      }
      if (Array.isArray(value)) {
        const separator: string = name.toLowerCase() === 'set-cookie' ? '; ' : ', ';
        return [[name, value.join(separator)]];
      }

      return [];
    }),
  );
}
