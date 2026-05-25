import type { WorkerCaughtError, WorkerIterationErrorLogPayload } from './worker-error-log.types';

export function buildWorkerCaughtErrorLogPayload(error: WorkerCaughtError): WorkerIterationErrorLogPayload {
  if (error instanceof Error) {
    return {
      err: error,
    };
  }
  if (error === null) {
    return {
      errorMessage: 'null',
    };
  }
  if (isStringifiableCaughtError(error)) {
    return {
      errorMessage: String(error),
    };
  }

  return {
    errorMessage: 'Non-Error throwable object.',
  };
}

function isStringifiableCaughtError(
  error: WorkerCaughtError,
): error is string | number | boolean | bigint | symbol | undefined {
  return (
    typeof error === 'string' ||
    typeof error === 'number' ||
    typeof error === 'boolean' ||
    typeof error === 'bigint' ||
    typeof error === 'symbol' ||
    typeof error === 'undefined'
  );
}
