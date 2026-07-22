import { randomInt } from 'node:crypto';
import type { ManagedDomainAllocationResponse } from '@compartment/contracts';
import { allocateManagedDomain, isCompartmentRequestError, isRetryableTransportRequestError } from '@compartment/sdk';
import { waitForInstallDelay } from './kubernetes-install-delay.service';
import type { KubernetesInstallProgressReporter } from './kubernetes-install-progress.types';
import { createApiRequester } from './context.service';
import type { ManagedDomainAllocationInput } from './managed-domain.service.types';

const managedDomainBrokerRequestTimeoutMs: number = 10_000;
const managedDomainBrokerMaxAttempts: number = 4;
const managedDomainBrokerRetryBaseMs: number = 1_000;
const managedDomainBrokerRetryCapMs: number = 8_000;

export async function allocateInstallManagedDomain(
  input: ManagedDomainAllocationInput,
  progress?: KubernetesInstallProgressReporter,
): Promise<ManagedDomainAllocationResponse> {
  const { brokerUrl, ...request }: ManagedDomainAllocationInput = input;
  for (let attempt: number = 1; attempt <= managedDomainBrokerMaxAttempts; attempt += 1) {
    try {
      return await allocateManagedDomain(createApiRequester(brokerUrl, managedDomainBrokerRequestTimeoutMs), request);
    } catch (error) {
      const failure: Error = error instanceof Error ? error : new Error('Unknown network request failure.');
      if (!isRetryableManagedDomainError(failure) || attempt === managedDomainBrokerMaxAttempts) {
        throw createManagedDomainAllocationError(failure, attempt);
      }
      const delayMs: number = readRetryDelayMs(attempt);
      progress?.report(
        `Requesting managed domain\u2026 transient failure on attempt ${attempt.toString()}/${managedDomainBrokerMaxAttempts.toString()}; retrying in ${formatDelay(delayMs)}.`,
      );
      await waitForInstallDelay(delayMs);
    }
  }
  throw new Error('Managed-domain broker request exhausted its retry policy. Re-run install to resume.');
}

function isRetryableManagedDomainError(error: Error): boolean {
  return (
    (isCompartmentRequestError(error) && (error.statusCode === 429 || error.statusCode >= 500)) ||
    isRetryableTransportRequestError(error)
  );
}

function createManagedDomainAllocationError(error: Error, attempts: number): Error {
  if (isCompartmentRequestError(error)) {
    const requestId: string = error.requestId === undefined ? '' : ` (request-id: ${error.requestId})`;
    if (error.statusCode !== 429 && error.statusCode < 500) {
      return new Error(
        `Managed-domain broker ${error.method} ${error.url} failed with status ${error.statusCode.toString()}${requestId}. Check the install configuration before re-running install.`,
      );
    }
    return new Error(
      `Managed-domain broker ${error.method} ${error.url} failed with status ${error.statusCode.toString()}${requestId}; transient failure after ${attempts.toString()} attempts. Re-run install to resume.`,
    );
  }
  return new Error(
    `Managed-domain broker request failed after ${attempts.toString()} attempts: ${error.message} This may be transient; re-run install to resume.`,
  );
}

function readRetryDelayMs(attempt: number): number {
  const exponentialDelay: number = Math.min(
    managedDomainBrokerRetryCapMs,
    managedDomainBrokerRetryBaseMs * 2 ** (attempt - 1),
  );
  return Math.round((exponentialDelay * randomInt(800, 1_201)) / 1_000);
}

function formatDelay(delayMs: number): string {
  return `${(delayMs / 1_000).toFixed(1)}s`;
}
