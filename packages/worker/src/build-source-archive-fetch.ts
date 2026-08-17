import {
  createCompartmentBinaryRequester,
  getArtifactSourceArchive,
  isCompartmentRequestError,
  isRetryableRequestError,
  readTransportFailureDiagnostic,
} from '@compartment/sdk';
import { waitForAbortOrTimeout } from '@compartment/utils';
import type {
  BuildSourceArchiveFetchInput,
  BuildSourceArchiveFetchRetryDiagnostic,
  BuildSourceArchiveFetchRetryInput,
} from './build-source-archive-fetch.types';

const sourceArchiveFetchMaximumAttempts: number = 96;
const sourceArchiveFetchRetryBaseMs: number = 250;
const sourceArchiveFetchRetryCapMs: number = 2_000;
const sourceArchiveFetchTimeoutMs: number = 180_000;

export async function fetchBuildSourceArchive(input: BuildSourceArchiveFetchInput): Promise<Buffer> {
  const startedAtMs: number = Date.now();
  const deadlineAtMs: number = startedAtMs + sourceArchiveFetchTimeoutMs;
  const target: string = `/internal/artifacts/${encodeURIComponent(input.artifactId)}/source-archive`;

  for (let attempt: number = 1; attempt <= sourceArchiveFetchMaximumAttempts; attempt += 1) {
    const remainingTimeoutMs: number = Math.max(1, sourceArchiveFetchTimeoutMs - (Date.now() - startedAtMs));
    try {
      return await executeSourceArchiveFetch(input, remainingTimeoutMs);
    } catch (error) {
      const failure: Error = error instanceof Error ? error : new Error('Unknown source archive fetch failure.');
      await retrySourceArchiveFetch({
        attempt,
        deadlineAtMs,
        failure,
        fetchInput: input,
        remainingTimeoutMs: sourceArchiveFetchTimeoutMs - (Date.now() - startedAtMs),
        target,
      });
    }
  }

  throw new Error('Source archive fetch exhausted its retry policy.');
}

export function isBuildSourceArchiveFetchRetryLine(message: string): boolean {
  return message.startsWith('Source archive fetch ');
}

export function readBuildSourceArchiveFetchRetryLine(diagnostic: BuildSourceArchiveFetchRetryDiagnostic): string {
  return `Source archive fetch ${diagnostic.target} attempt ${diagnostic.attempt.toString()}/${diagnostic.maximumAttempts.toString()} failed: ${diagnostic.diagnostic}; retrying in ${diagnostic.delayMs.toString()}ms.`;
}

async function executeSourceArchiveFetch(
  input: BuildSourceArchiveFetchInput,
  requestTimeoutMs: number,
): Promise<Buffer> {
  return await getArtifactSourceArchive(
    createCompartmentBinaryRequester(
      {
        apiUrl: input.apiUrl,
        internalToken: input.sourceArchiveCredential,
        requestTimeoutMs,
      },
      { maximumAttempts: 1 },
    ),
    input.artifactId,
  );
}

async function retrySourceArchiveFetch(input: BuildSourceArchiveFetchRetryInput): Promise<void> {
  const diagnostic: string = readSourceArchiveFetchDiagnostic(input.failure);
  const retryDelayMs: number = readSourceArchiveRetryDelayMs(input.attempt);
  if (
    !isRetryableRequestError(input.failure) ||
    input.attempt === sourceArchiveFetchMaximumAttempts ||
    retryDelayMs >= input.remainingTimeoutMs
  ) {
    throwSourceArchiveFetchFailure(input, diagnostic);
  }
  const retryDiagnostic: BuildSourceArchiveFetchRetryDiagnostic = {
    attempt: input.attempt,
    delayMs: retryDelayMs,
    diagnostic,
    maximumAttempts: sourceArchiveFetchMaximumAttempts,
    target: input.target,
  };
  input.fetchInput.onRetry(retryDiagnostic);
  await waitForAbortOrTimeout(retryDelayMs);
  if (Date.now() >= input.deadlineAtMs) {
    throwSourceArchiveFetchFailure(input, diagnostic);
  }
}

function throwSourceArchiveFetchFailure(input: BuildSourceArchiveFetchRetryInput, diagnostic: string): never {
  throw new Error(
    `Source archive fetch ${input.target} failed after ${input.attempt.toString()}/${sourceArchiveFetchMaximumAttempts.toString()} attempts within the ${Math.ceil(sourceArchiveFetchTimeoutMs / 1_000).toString()} second budget: ${diagnostic}.`,
    { cause: input.failure },
  );
}

function readSourceArchiveRetryDelayMs(attempt: number): number {
  return Math.min(sourceArchiveFetchRetryCapMs, sourceArchiveFetchRetryBaseMs * 2 ** (attempt - 1));
}

function readSourceArchiveFetchDiagnostic(failure: Error): string {
  if (isCompartmentRequestError(failure)) {
    return `HTTP ${failure.statusCode.toString()} (code: ${failure.code})`;
  }
  return readTransportFailureDiagnostic(failure);
}
