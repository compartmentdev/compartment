import { errorResponseSchema, type ErrorResponse } from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';
import { ZodError, type SafeParseReturnType } from 'zod';
import type { ClientOptions } from '../client.types';
import type {
  CompartmentRequestMethod,
  CompartmentBinaryRequestOptions,
  CompartmentRequestOptions,
  CompartmentRequestErrorFields,
  CompartmentBinaryRequester,
  CompartmentRawRequestOptions,
  CompartmentRawRequester,
  CompartmentRequestSchema,
  CompartmentRequester,
} from './request.types';
import {
  CompartmentRequestError,
  createRequestSignal,
  createTransportRequestError,
  isRetryableTransportRequestError,
  type RequestTransportFailure,
  type RequestTransportOptions,
} from './request-error';
import { createRawRequestHeaders, createRequestHeaders } from './request-headers';

export function isCompartmentRequestError(
  value: Error | null | undefined,
): value is Error & CompartmentRequestErrorFields {
  const candidate: Partial<CompartmentRequestErrorFields> & { name?: string | undefined } =
    (value as (Partial<CompartmentRequestErrorFields> & { name?: string | undefined }) | null | undefined) ?? {};

  return (
    value instanceof Error &&
    candidate.name === 'CompartmentRequestError' &&
    typeof candidate.code === 'string' &&
    typeof candidate.statusCode === 'number' &&
    typeof candidate.method === 'string' &&
    typeof candidate.url === 'string'
  );
}

/**
 * A request is worth another attempt when the transport never delivered a verdict, or when the server answered with
 * one it invites the caller to retry.
 */
export function isRetryableRequestError(error: Error | null | undefined): boolean {
  return (
    (isCompartmentRequestError(error) && (error.statusCode === 429 || error.statusCode >= 500)) ||
    isRetryableTransportRequestError(error)
  );
}

export function createCompartmentRequester(defaultOptions: ClientOptions): CompartmentRequester {
  return async function request<TResult, TBody>({
    body,
    method,
    path,
    schema,
    ...requestOptions
  }: CompartmentRequestOptions<TResult, TBody>): Promise<TResult> {
    const headers: Headers = createRequestHeaders(body, requestOptions, defaultOptions);
    const url: string = createRequestUrl(defaultOptions, path);
    return await readJsonRequestResponse(
      path,
      schema,
      fetchCompartmentResponse(url, createRequestInit(body, headers, method, defaultOptions.requestTimeoutMs), {
        method,
        path,
        requestTimeoutMs: defaultOptions.requestTimeoutMs,
        url,
      }),
      { method, url },
    );
  };
}

export function createCompartmentBinaryRequester(defaultOptions: ClientOptions): CompartmentBinaryRequester {
  return async function request({ method, path, ...requestOptions }: CompartmentBinaryRequestOptions): Promise<Buffer> {
    const headers: Headers = createRequestHeaders(undefined, requestOptions, defaultOptions);
    const url: string = createRequestUrl(defaultOptions, path);
    const response: Response = await fetchCompartmentResponse(
      url,
      createRequestInit(undefined, headers, method, defaultOptions.requestTimeoutMs),
      { method, path, requestTimeoutMs: defaultOptions.requestTimeoutMs, url },
    );

    if (!response.ok) {
      throw await createBinaryRequestError(response, { method, url });
    }
    return Buffer.from(await response.arrayBuffer());
  };
}

export function createCompartmentRawRequester(defaultOptions: ClientOptions): CompartmentRawRequester {
  return async function request<TResult>({
    body,
    contentType,
    method,
    path,
    schema,
    ...requestOptions
  }: CompartmentRawRequestOptions<TResult>): Promise<TResult> {
    const headers: Headers = createRawRequestHeaders(contentType, requestOptions, defaultOptions);
    const url: string = createRequestUrl(defaultOptions, path);
    return await readJsonRequestResponse(
      path,
      schema,
      fetchCompartmentResponse(url, createRawRequestInit(body, headers, method, defaultOptions.requestTimeoutMs), {
        method,
        path,
        requestTimeoutMs: defaultOptions.requestTimeoutMs,
        url,
      }),
      { method, url },
    );
  };
}

async function readJsonRequestResponse<TResult>(
  path: string,
  schema: CompartmentRequestSchema<TResult>,
  responsePromise: Promise<Response>,
  request: Pick<CompartmentRequestErrorFields, 'method' | 'url'>,
): Promise<TResult> {
  const response: Response = await responsePromise;
  const payload: JsonValue = await readJsonPayload(response);
  if (!response.ok) {
    throw createCompartmentRequestError(payload, response, request);
  }
  return parseResponsePayload(payload, path, schema);
}

function createRequestUrl(defaultOptions: ClientOptions, path: string): string {
  return `${defaultOptions.apiUrl.replace(/\/$/, '')}${path}`;
}

function createRequestInit<TBody>(
  body: TBody | undefined,
  headers: Headers,
  method: CompartmentRequestMethod,
  requestTimeoutMs?: number | null,
): RequestInit {
  const requestInit: RequestInit = {
    headers,
    method,
  };
  const signal: AbortSignal | undefined = createRequestSignal(requestTimeoutMs);
  if (signal !== undefined) {
    requestInit.signal = signal;
  }
  if (body !== undefined) {
    requestInit.body = toRequestBody(body);
  }

  return requestInit;
}

function createRawRequestInit(
  body: Buffer | Uint8Array,
  headers: Headers,
  method: CompartmentRequestMethod,
  requestTimeoutMs?: number | null,
): RequestInit {
  const requestInit: RequestInit = {
    body,
    headers,
    method,
  };
  const signal: AbortSignal | undefined = createRequestSignal(requestTimeoutMs);
  if (signal !== undefined) {
    requestInit.signal = signal;
  }

  return requestInit;
}

async function fetchCompartmentResponse(
  url: string,
  init: RequestInit,
  options: RequestTransportOptions,
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (options.requestTimeoutMs === undefined) {
      throw error;
    }

    throw createTransportRequestError(options, error as RequestTransportFailure);
  }
}

async function createBinaryRequestError(
  response: Response,
  request: Pick<CompartmentRequestErrorFields, 'method' | 'url'>,
): Promise<CompartmentRequestError> {
  try {
    return createCompartmentRequestError(await readJsonPayload(response), response, request);
  } catch {
    return createCompartmentRequestError(null, response, request);
  }
}

function createCompartmentRequestError(
  payload: JsonValue,
  response: Response,
  request: Pick<CompartmentRequestErrorFields, 'method' | 'url'>,
): CompartmentRequestError {
  const requestId: string | undefined = response.headers.get('x-request-id') ?? undefined;
  const context: Pick<CompartmentRequestErrorFields, 'method' | 'requestId' | 'statusCode' | 'url'> = {
    ...request,
    requestId,
    statusCode: response.status,
  };
  const parsedError: SafeParseReturnType<JsonValue, ErrorResponse> = errorResponseSchema.safeParse(payload);
  if (parsedError.success) {
    return new CompartmentRequestError({
      code: parsedError.data.error.code,
      message: parsedError.data.error.message,
      ...context,
    });
  }

  return new CompartmentRequestError({
    code: 'request_error',
    message: `${request.method} ${request.url} failed with status ${response.status.toString()}${requestId === undefined ? '' : ` (request-id: ${requestId})`}.`,
    ...context,
  });
}

function parseResponsePayload<TResult>(
  payload: JsonValue,
  path: string,
  schema: CompartmentRequestSchema<TResult>,
): TResult {
  try {
    return schema.parse(payload);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(`Compartment API returned an invalid response for ${path}.`);
    }

    throw error;
  }
}

async function readJsonPayload(response: Response): Promise<JsonValue> {
  const text: string = await response.text();
  if (text === '') {
    return null;
  }

  try {
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as JsonValue;
  } catch {
    return null;
  }
}

function toRequestBody<TBody>(body: TBody): FormData | string {
  return body instanceof FormData ? body : JSON.stringify(body);
}
