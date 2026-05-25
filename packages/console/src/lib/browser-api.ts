import {
  compartmentCsrfCookieName,
  compartmentCsrfHeaderName,
  compartmentCurrentOrganizationHeaderName,
} from '@compartment/contracts/browser';
import { readCookieValue } from '@compartment/utils';
import type { ZodType } from 'zod';

type BrowserApiMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST';

export interface BrowserApiRequestOptions {
  signal?: AbortSignal | undefined;
}

interface BrowserApiOptions<TJson> extends BrowserApiRequestOptions {
  currentOrganization?: string | undefined;
  json?: TJson | undefined;
  method?: BrowserApiMethod | undefined;
}

interface BrowserApiErrorBody {
  error?: BrowserApiErrorDetails | undefined;
  message?: string | undefined;
}

interface BrowserApiErrorDetails {
  code?: string | undefined;
  message?: string | undefined;
}

export class BrowserApiError extends Error {
  readonly code: string | undefined;
  readonly status: number;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.code = code;
    this.name = 'BrowserApiError';
    this.status = status;
  }
}

export function isBrowserApiNetworkError(error: Error): boolean {
  return error instanceof TypeError && error.message === 'Failed to fetch';
}

export async function requestBrowserApi<TResult, TJson = undefined>(
  path: string,
  schema: ZodType<TResult>,
  options: BrowserApiOptions<TJson> = {},
): Promise<TResult> {
  const response: Response = await fetch(path, createBrowserApiRequestInit(options));
  if (!response.ok) {
    const error: BrowserApiErrorDetails = await readBrowserApiError(response);
    throw new BrowserApiError(
      response.status,
      error.message ?? `Request failed with status ${response.status}.`,
      error.code,
    );
  }

  return schema.parse(await response.json());
}

function createBrowserApiRequestInit<TJson>(options: BrowserApiOptions<TJson>): RequestInit {
  const init: RequestInit = {
    credentials: 'same-origin',
    headers: buildBrowserApiHeaders(options),
    method: options.method ?? 'GET',
  };
  if (options.signal !== undefined) {
    init.signal = options.signal;
  }
  if (options.json !== undefined) {
    init.body = JSON.stringify(options.json);
  }

  return init;
}

function buildBrowserApiHeaders<TJson>(options: BrowserApiOptions<TJson>): Headers {
  const headers: Headers = new Headers({
    Accept: 'application/json',
  });
  if (options.json !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  if (options.currentOrganization !== undefined) {
    headers.set(compartmentCurrentOrganizationHeaderName, options.currentOrganization);
  }
  if (!isSafeMethod(options.method ?? 'GET')) {
    const csrfToken: string | undefined = readBrowserCookie(compartmentCsrfCookieName);
    if (csrfToken !== undefined) {
      headers.set(compartmentCsrfHeaderName, csrfToken);
    }
  }

  return headers;
}

function isSafeMethod(method: BrowserApiMethod): boolean {
  return method === 'GET';
}

async function readBrowserApiError(response: Response): Promise<BrowserApiErrorDetails> {
  try {
    const body: BrowserApiErrorBody = (await response.json()) as BrowserApiErrorBody;
    return {
      code: readErrorCode(body),
      message: readErrorMessage(body),
    };
  } catch {
    return {};
  }
}

function readErrorCode(body: BrowserApiErrorBody): string | undefined {
  return typeof body.error?.code === 'string' ? body.error.code : undefined;
}

function readErrorMessage(body: BrowserApiErrorBody): string | undefined {
  if (typeof body.message === 'string') {
    return body.message;
  }
  if (typeof body.error?.message === 'string') {
    return body.error.message;
  }

  return undefined;
}

function readBrowserCookie(name: string): string | undefined {
  return readCookieValue(document.cookie, name);
}
