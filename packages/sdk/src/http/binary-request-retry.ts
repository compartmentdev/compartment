import { randomInt } from 'node:crypto';
import { waitForAbortOrTimeout } from '@compartment/utils';
import {
  CompartmentRequestError,
  isCompartmentRequestError,
  isRetryableRequestError,
  readTransportFailureDiagnostic,
} from './request-error';
import type { CompartmentBinaryRequestExecution, CompartmentRequestMethod } from './request.types';

const binaryGetMaxAttempts: number = 8;
const binaryGetRetryBaseMs: number = 250;
const binaryGetRetryCapMs: number = 2_000;

export async function executeCompartmentBinaryRequest({
  execute,
  method,
  path,
  url,
}: CompartmentBinaryRequestExecution): Promise<Buffer> {
  const maximumAttempts: number = method === 'GET' ? binaryGetMaxAttempts : 1;

  for (let attempt: number = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return await execute();
    } catch (error) {
      const failure: Error = error instanceof Error ? error : new Error('Unknown network request failure.');
      if (method !== 'GET') {
        throw failure;
      }
      if (attempt === maximumAttempts || !isRetryableRequestError(failure)) {
        throw createBinaryRequestFailure(failure, method, path, url, attempt, maximumAttempts);
      }
      await waitForAbortOrTimeout(readBinaryGetRetryDelayMs(attempt));
    }
  }

  throw new Error('Binary GET exhausted its retry policy.');
}

function readBinaryGetRetryDelayMs(attempt: number): number {
  const maximumDelayMs: number = Math.min(binaryGetRetryCapMs, binaryGetRetryBaseMs * 2 ** (attempt - 1));
  const minimumDelayMs: number = Math.ceil(maximumDelayMs / 2);
  return randomInt(minimumDelayMs, maximumDelayMs + 1);
}

function createBinaryRequestFailure(
  failure: Error,
  method: CompartmentRequestMethod,
  path: string,
  url: string,
  attempts: number,
  maximumAttempts: number,
): Error {
  const target: string = sanitizeBinaryRequestTarget(url, path);
  const attemptContext: string = `${attempts.toString()}/${maximumAttempts.toString()} attempts`;
  if (isCompartmentRequestError(failure)) {
    const originalMessage: string = failure.code === 'request_error' ? '' : `${failure.message} `;
    return new CompartmentRequestError({
      code: failure.code,
      message: `${originalMessage}${method} ${target} failed after ${attemptContext} with status ${failure.statusCode.toString()} (code: ${failure.code}).`,
      method,
      requestId: failure.requestId,
      statusCode: failure.statusCode,
      url: target,
    });
  }

  return new Error(`${method} ${target} failed after ${attemptContext}: ${readTransportFailureDiagnostic(failure)}.`, {
    cause: failure,
  });
}

export function sanitizeBinaryRequestTarget(url: string, path: string): string {
  try {
    const parsedUrl: URL = new URL(url);
    parsedUrl.username = '';
    parsedUrl.password = '';
    parsedUrl.search = '';
    parsedUrl.hash = '';
    return parsedUrl.toString();
  } catch {
    return path.split(/[?#]/u, 1)[0] ?? '/';
  }
}

export function sanitizeBinaryRequestPath(path: string): string {
  return path.split(/[?#]/u, 1)[0] ?? '/';
}
