import type { CompartmentRequestMethod } from './request.types';

export interface RequestTransportOptions {
  method: CompartmentRequestMethod;
  path: string;
  requestTimeoutMs?: number | null | undefined;
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
  'ETIMEDOUT',
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
  const code: string | null = readTransportFailureCode(error);
  return code !== null && retryableTransportFailureCodes.has(code);
}

function readTransportRequestErrorMessage(options: RequestTransportOptions, cause: RequestTransportFailure): string {
  if (cause instanceof Error && cause.name === 'TimeoutError') {
    return `${options.method} ${options.path} timed out after ${Math.ceil((options.requestTimeoutMs ?? 0) / 1000)} seconds.`;
  }

  return `${options.method} ${options.path} failed: ${readTransportFailureReason(cause)}.`;
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

  if (code === 'ETIMEDOUT') {
    return 'connection timed out';
  }

  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') {
    return 'connection closed';
  }

  return 'network request failed';
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
