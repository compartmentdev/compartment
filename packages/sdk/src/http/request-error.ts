import type {
  CompartmentRequestErrorCandidate,
  CompartmentRequestErrorFields,
  CompartmentRequestMethod,
} from './request.types';

interface CompartmentRequestErrorInput extends CompartmentRequestErrorFields {
  message: string;
}

export class CompartmentRequestError extends Error {
  public readonly code: string;
  public readonly method: CompartmentRequestMethod;
  public readonly requestId?: string | undefined;
  public readonly statusCode: number;
  public readonly url: string;

  public constructor({ code, message, method, requestId, statusCode, url }: CompartmentRequestErrorInput) {
    super(message);
    this.name = 'CompartmentRequestError';
    this.code = code;
    this.method = method;
    this.requestId = requestId;
    this.statusCode = statusCode;
    this.url = url;
  }
}

export function isCompartmentRequestError(
  value: Error | null | undefined,
): value is Error & CompartmentRequestErrorFields {
  const candidate: CompartmentRequestErrorCandidate =
    (value as CompartmentRequestErrorCandidate | null | undefined) ?? {};

  return (
    value instanceof Error &&
    candidate.name === 'CompartmentRequestError' &&
    typeof candidate.code === 'string' &&
    typeof candidate.statusCode === 'number' &&
    typeof candidate.method === 'string' &&
    typeof candidate.url === 'string'
  );
}

export function isRetryableRequestError(error: Error | null | undefined): boolean {
  return (
    (isCompartmentRequestError(error) &&
      (error.statusCode === 429 || (error.statusCode >= 500 && error.statusCode <= 599))) ||
    isRetryableTransportRequestError(error)
  );
}

export interface RequestTransportOptions {
  method: CompartmentRequestMethod;
  path: string;
  requestTimeoutMs?: number | null | undefined;
  url?: string | undefined;
}

interface RequestTransportFailureShape {
  cause?: RequestTransportFailure | null | undefined;
  code?: string | undefined;
}

export type RequestTransportFailure = Error | RequestTransportFailureShape | null | undefined;

const retryableTransportFailureCodes: Set<string> = new Set<string>([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ENOTFOUND',
  'ETIMEDOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

export function createTransportRequestError(options: RequestTransportOptions, cause: RequestTransportFailure): Error {
  const error: Error = new Error(readTransportRequestErrorMessage(options, cause));
  (error as Error & { cause?: RequestTransportFailure | undefined }).cause = cause;
  return error;
}

export function createRequestSignal(requestTimeoutMs?: number | null): AbortSignal | undefined {
  return requestTimeoutMs === undefined || requestTimeoutMs === null
    ? undefined
    : AbortSignal.timeout(requestTimeoutMs);
}

export function isRetryableTransportRequestError(error: RequestTransportFailure): boolean {
  if (hasTransportTimeout(error)) {
    return true;
  }
  const code: string | null = readTransportFailureCode(error);
  return code !== null && retryableTransportFailureCodes.has(code);
}

export function readTransportFailureDiagnostic(error: RequestTransportFailure): string {
  const code: string | null = readTransportFailureCode(error);
  const nestedErrorName: string | null = readNestedTransportErrorName(error);
  const causeContext: string = nestedErrorName === null ? '' : `; nested cause: ${nestedErrorName}`;
  const codeContext: string = code === null ? '' : `; code: ${code}`;
  const reason: string = hasTransportTimeout(error) ? 'request timed out' : readTransportFailureReason(error);

  return `${reason}${causeContext}${codeContext}`;
}

function hasTransportTimeout(error: RequestTransportFailure): boolean {
  let candidate: RequestTransportFailure = error;
  const visitedCandidates: Set<object> = new Set<object>();
  while (candidate !== null && candidate !== undefined) {
    if (candidate instanceof Error && (candidate.name === 'AbortError' || candidate.name === 'TimeoutError')) {
      return true;
    }
    if (typeof candidate !== 'object' || visitedCandidates.has(candidate)) {
      return false;
    }
    visitedCandidates.add(candidate);
    candidate = readTransportFailureCause(candidate);
  }
  return false;
}

function readTransportRequestErrorMessage(options: RequestTransportOptions, cause: RequestTransportFailure): string {
  const urlContext: string = options.url === undefined ? '' : ` URL: ${options.url}.`;
  if (cause instanceof Error && cause.name === 'TimeoutError') {
    return `${options.method} ${options.path} timed out after ${Math.ceil((options.requestTimeoutMs ?? 0) / 1000)} seconds.${urlContext}`;
  }

  return `${options.method} ${options.path} failed: ${readTransportFailureReason(cause)}.${urlContext}`;
}

function readTransportFailureReason(cause: RequestTransportFailure): string {
  const code: string | null = readTransportFailureCode(cause);

  if (code === 'ECONNREFUSED') {
    return 'connection refused';
  }

  if (code === 'ENOTFOUND') {
    return 'host not found';
  }

  if (code === 'EAI_AGAIN') {
    return 'DNS lookup failed';
  }

  if (
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_BODY_TIMEOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_HEADERS_TIMEOUT'
  ) {
    return 'connection timed out';
  }

  if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'UND_ERR_SOCKET') {
    return 'connection closed';
  }

  return 'network request failed';
}

function readNestedTransportErrorName(error: RequestTransportFailure): string | null {
  let candidate: RequestTransportFailure = readTransportFailureCause(error);
  const visitedCandidates: Set<object> = new Set<object>();

  while (candidate !== null && candidate !== undefined) {
    if (candidate instanceof Error) {
      return candidate.name;
    }
    if (typeof candidate !== 'object' || visitedCandidates.has(candidate)) {
      return null;
    }
    visitedCandidates.add(candidate);
    candidate = readTransportFailureCause(candidate);
  }

  return null;
}

function readTransportFailureCode(cause: RequestTransportFailure): string | null {
  let candidate: RequestTransportFailure = cause;
  const visitedCandidates: Set<object> = new Set<object>();

  while (candidate !== null && candidate !== undefined) {
    const code: string | null = readTransportFailureCandidateCode(candidate);
    if (code !== null) {
      return code;
    }

    if (typeof candidate !== 'object' || visitedCandidates.has(candidate)) {
      return null;
    }

    visitedCandidates.add(candidate);
    candidate = readTransportFailureCause(candidate);
  }

  return null;
}

function readTransportFailureCause(cause: RequestTransportFailure): RequestTransportFailure {
  return cause !== null && typeof cause === 'object' && 'cause' in cause
    ? (cause as RequestTransportFailureShape).cause
    : undefined;
}

function readTransportFailureCandidateCode(cause: RequestTransportFailure): string | null {
  return cause !== null && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
    ? cause.code
    : null;
}
