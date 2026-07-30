import { randomInt } from 'node:crypto';
import { managedDomainAllocationPathname, type ManagedDomainAllocationResponse } from '@compartment/contracts';
import { allocateManagedDomain, isCompartmentRequestError, isRetryableTransportRequestError } from '@compartment/sdk';
import { waitForInstallDelay } from './kubernetes-install-delay.service';
import type { KubernetesInstallProgressReporter } from './kubernetes-install-progress.types';
import { createApiRequester } from './context.service';
import type { ManagedDomainAllocationInput, ManagedDomainRequestFailure } from './managed-domain.service.types';

const brokerRequestTimeoutMs: number = 10_000;
const brokerMaxAttempts: number = 4;
const brokerRetryBaseMs: number = 1_000;
const brokerRetryCapMs: number = 8_000;

export async function allocateInstallManagedDomain(
  input: ManagedDomainAllocationInput,
  progress?: KubernetesInstallProgressReporter,
): Promise<ManagedDomainAllocationResponse> {
  const { brokerUrl, ...request } = input;
  const requestUrl: string = resolveManagedDomainRequestUrl(brokerUrl, managedDomainAllocationPathname);
  return await runManagedDomainRequest(
    async (): Promise<ManagedDomainAllocationResponse> =>
      await allocateManagedDomain(createApiRequester(brokerUrl, brokerRequestTimeoutMs), request),
    'allocate managed domain',
    'POST',
    requestUrl,
    progress,
  );
}

async function runManagedDomainRequest<TResult>(
  request: () => Promise<TResult>,
  operation: string,
  method: 'POST',
  requestUrl: string,
  progress?: KubernetesInstallProgressReporter,
): Promise<TResult> {
  for (let attempt: number = 1; attempt <= brokerMaxAttempts; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      const failure: Error = error instanceof Error ? error : new Error('Unknown network request failure.');
      if (!isRetryableManagedDomainError(failure) || attempt === brokerMaxAttempts) {
        throw createManagedDomainError(failure, attempt, operation, method, requestUrl);
      }
      const delayMs: number = readRetryDelayMs(attempt);
      progress?.report(
        `${operation}\u2026 transient failure on attempt ${attempt.toString()}/${brokerMaxAttempts.toString()}; retrying in ${formatDelay(delayMs)}.`,
      );
      await waitForInstallDelay(delayMs);
    }
  }
  throw new Error(`Managed-domain broker ${operation} exhausted its retry policy. Re-run install to resume.`);
}

function isRetryableManagedDomainError(error: Error): boolean {
  return (
    (isCompartmentRequestError(error) && (error.statusCode === 429 || error.statusCode >= 500)) ||
    isRetryableTransportRequestError(error)
  );
}

function createManagedDomainError(
  error: Error,
  attempts: number,
  operation: string,
  method: 'POST',
  requestUrl: string,
): Error {
  if (isCompartmentRequestError(error)) {
    return createCompartmentManagedDomainError(error, attempts, operation, requestUrl);
  }
  if (!isRetryableTransportRequestError(error)) {
    return new Error(
      `Managed-domain broker ${method} ${requestUrl} request failed while attempting to ${operation}: ${error.message} Check the broker configuration and response before re-running install.`,
    );
  }
  return new Error(
    `Managed-domain broker ${method} ${requestUrl} failed after ${attempts.toString()} attempts while attempting to ${operation}: ${error.message} Network failure; re-run install to resume.`,
  );
}

function createCompartmentManagedDomainError(
  error: ManagedDomainRequestFailure,
  attempts: number,
  operation: string,
  requestUrl: string,
): Error {
  const absoluteUrl: string = resolveManagedDomainRequestUrl(requestUrl, error.url);
  const requestId: string = error.requestId === undefined ? '' : ` (request-id: ${error.requestId})`;
  if (error.statusCode !== 429 && error.statusCode < 500) {
    return new Error(
      `Managed-domain broker ${error.method} ${absoluteUrl} failed with status ${error.statusCode.toString()}${requestId} while attempting to ${operation}. Check the install configuration before re-running install.`,
    );
  }
  return new Error(
    `Managed-domain broker ${error.method} ${absoluteUrl} failed with status ${error.statusCode.toString()}${requestId}; transient failure after ${attempts.toString()} attempts while attempting to ${operation}. Re-run install to resume.`,
  );
}

function resolveManagedDomainRequestUrl(baseUrl: string, path: string): string {
  try {
    const resolvedBaseUrl: URL = new URL(baseUrl);
    if (
      (resolvedBaseUrl.protocol !== 'http:' && resolvedBaseUrl.protocol !== 'https:') ||
      resolvedBaseUrl.username !== '' ||
      resolvedBaseUrl.password !== ''
    ) {
      throw new Error('Unsupported managed-domain broker URL protocol.');
    }
    const absolutePathUrl: URL | null = readAbsoluteHttpUrl(path);
    return absolutePathUrl?.toString() ?? `${resolvedBaseUrl.toString().replace(/\/$/u, '')}${path}`;
  } catch {
    throw new Error(
      'Managed-domain broker configuration is invalid. Set --broker-url or COMPARTMENT_MANAGED_DOMAIN_BROKER_URL to an absolute HTTP(S) URL without credentials.',
    );
  }
}

function readAbsoluteHttpUrl(value: string): URL | null {
  try {
    const url: URL = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function readRetryDelayMs(attempt: number): number {
  const exponentialDelay: number = Math.min(brokerRetryCapMs, brokerRetryBaseMs * 2 ** (attempt - 1));
  return Math.round((exponentialDelay * randomInt(800, 1_201)) / 1_000);
}

function formatDelay(delayMs: number): string {
  return `${(delayMs / 1_000).toFixed(1)}s`;
}
