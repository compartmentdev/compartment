import {
  compartmentCurrentOrganizationHeaderName,
  errorResponseSchema,
  type ErrorResponse,
} from '@compartment/contracts';
import { hasText, type JsonValue } from '@compartment/utils';
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
  createRequestSignal,
  createTransportRequestError,
  type RequestTransportFailure,
  type RequestTransportOptions,
} from './request-error';

interface RequestHeaderOptions {
  currentOrganization?: string | undefined;
  internalToken?: string | undefined;
  sessionToken?: string | undefined;
}

interface CompartmentRequestErrorInput {
  code: string;
  message: string;
  statusCode: number;
}

class CompartmentRequestError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  public constructor({ code, message, statusCode }: CompartmentRequestErrorInput) {
    super(message);
    this.name = 'CompartmentRequestError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function isCompartmentRequestError(
  value: Error | null | undefined,
): value is Error & CompartmentRequestErrorFields {
  const candidate: Partial<CompartmentRequestErrorFields> & { name?: string | undefined } =
    (value as (Partial<CompartmentRequestErrorFields> & { name?: string | undefined }) | null | undefined) ?? {};

  return (
    value instanceof Error &&
    candidate.name === 'CompartmentRequestError' &&
    typeof candidate.code === 'string' &&
    typeof candidate.statusCode === 'number'
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
    return await readJsonRequestResponse(
      path,
      schema,
      fetchCompartmentResponse(
        createRequestUrl(defaultOptions, path),
        createRequestInit(body, headers, method, defaultOptions.requestTimeoutMs),
        { method, path, requestTimeoutMs: defaultOptions.requestTimeoutMs },
      ),
    );
  };
}

export function createCompartmentBinaryRequester(defaultOptions: ClientOptions): CompartmentBinaryRequester {
  return async function request({ method, path, ...requestOptions }: CompartmentBinaryRequestOptions): Promise<Buffer> {
    const headers: Headers = createRequestHeaders(undefined, requestOptions, defaultOptions);
    const response: Response = await fetchCompartmentResponse(
      createRequestUrl(defaultOptions, path),
      createRequestInit(undefined, headers, method, defaultOptions.requestTimeoutMs),
      { method, path, requestTimeoutMs: defaultOptions.requestTimeoutMs },
    );

    if (!response.ok) {
      throw await createBinaryRequestError(response);
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
    return await readJsonRequestResponse(
      path,
      schema,
      fetchCompartmentResponse(
        createRequestUrl(defaultOptions, path),
        createRawRequestInit(body, headers, method, defaultOptions.requestTimeoutMs),
        { method, path, requestTimeoutMs: defaultOptions.requestTimeoutMs },
      ),
    );
  };
}

async function readJsonRequestResponse<TResult>(
  path: string,
  schema: CompartmentRequestSchema<TResult>,
  responsePromise: Promise<Response>,
): Promise<TResult> {
  const response: Response = await responsePromise;
  const payload: JsonValue = await readJsonPayload(response);
  if (!response.ok) {
    throw createCompartmentRequestError(payload, response.status);
  }
  return parseResponsePayload(payload, path, schema);
}

function createRequestHeaders<TBody>(
  body: TBody | undefined,
  options: RequestHeaderOptions,
  defaults: ClientOptions,
): Headers {
  return createRawRequestHeaders(shouldSetJsonContentType(body) ? 'application/json' : null, options, defaults);
}

function createRawRequestHeaders(
  contentType: string | null,
  options: RequestHeaderOptions,
  defaults: ClientOptions,
): Headers {
  const headers: Headers = new Headers({
    Accept: 'application/json',
  });
  if (contentType !== null) headers.set('Content-Type', contentType);
  const authorizationToken: string | undefined = resolveAuthorizationToken(options, defaults);
  if (hasText(authorizationToken)) headers.set('Authorization', `Bearer ${authorizationToken}`);
  const currentOrganization: string | undefined = options.currentOrganization ?? defaults.currentOrganization;
  if (hasText(currentOrganization)) headers.set(compartmentCurrentOrganizationHeaderName, currentOrganization);
  return headers;
}

function resolveAuthorizationToken(options: RequestHeaderOptions, defaults: ClientOptions): string | undefined {
  return options.sessionToken ?? defaults.sessionToken ?? options.internalToken ?? defaults.internalToken;
}

function createRequestUrl(defaultOptions: ClientOptions, path: string): string {
  return `${defaultOptions.apiUrl.replace(/\/$/, '')}${path}`;
}

function createRequestInit<TBody>(
  body: TBody | undefined,
  headers: Headers,
  method: CompartmentRequestMethod,
  requestTimeoutMs?: number,
): RequestInit {
  const requestInit: RequestInit = {
    headers,
    method,
  };
  const signal: AbortSignal | undefined = createRequestSignal(requestTimeoutMs);
  if (signal !== undefined) requestInit.signal = signal;
  if (body !== undefined) requestInit.body = toRequestBody(body);

  return requestInit;
}

function createRawRequestInit(
  body: Buffer | Uint8Array,
  headers: Headers,
  method: CompartmentRequestMethod,
  requestTimeoutMs?: number,
): RequestInit {
  const requestInit: RequestInit = {
    body,
    headers,
    method,
  };
  const signal: AbortSignal | undefined = createRequestSignal(requestTimeoutMs);
  if (signal !== undefined) requestInit.signal = signal;

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

async function createBinaryRequestError(response: Response): Promise<CompartmentRequestError> {
  try {
    return createCompartmentRequestError(await readJsonPayload(response), response.status);
  } catch {
    return createCompartmentRequestError(null, response.status);
  }
}

function createCompartmentRequestError(payload: JsonValue, statusCode: number): CompartmentRequestError {
  const parsedError: SafeParseReturnType<JsonValue, ErrorResponse> = errorResponseSchema.safeParse(payload);
  if (parsedError.success) {
    return new CompartmentRequestError({
      code: parsedError.data.error.code,
      message: parsedError.data.error.message,
      statusCode,
    });
  }

  return new CompartmentRequestError({
    code: 'request_error',
    message: `Request failed with status ${statusCode}`,
    statusCode,
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

function shouldSetJsonContentType<TBody>(body: TBody | undefined): boolean {
  return body !== undefined && !(body instanceof FormData);
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
