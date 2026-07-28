import { randomInt } from 'node:crypto';
import type { ManagedDomainReservationResponse, ManagedDomainTargetBindingResponse } from '@compartment/contracts';
import {
  bindManagedDomainTargets,
  isCompartmentRequestError,
  isRetryableTransportRequestError,
  reserveManagedDomain,
} from '@compartment/sdk';
import { waitForInstallDelay } from './kubernetes-install-delay.service';
import type { KubernetesInstallProgressReporter } from './kubernetes-install-progress.types';
import { createApiRequester } from './context.service';
import type { ManagedDomainBindingInput, ManagedDomainReservationInput } from './managed-domain.service.types';

const brokerRequestTimeoutMs: number = 10_000;
const brokerMaxAttempts: number = 4;
const brokerRetryBaseMs: number = 1_000;
const brokerRetryCapMs: number = 8_000;

export async function reserveInstallManagedDomain(
  input: ManagedDomainReservationInput,
  progress?: KubernetesInstallProgressReporter,
): Promise<ManagedDomainReservationResponse> {
  const { brokerUrl, reservationToken, ...request } = input;
  return await runManagedDomainRequest(
    async (): Promise<ManagedDomainReservationResponse> =>
      await reserveManagedDomain(createApiRequester(brokerUrl, brokerRequestTimeoutMs), reservationToken, request),
    'reserve managed domain',
    progress,
  );
}

export async function bindInstallManagedDomainTargets(
  input: ManagedDomainBindingInput,
  progress?: KubernetesInstallProgressReporter,
): Promise<ManagedDomainTargetBindingResponse> {
  return await runManagedDomainRequest(
    async (): Promise<ManagedDomainTargetBindingResponse> =>
      await bindManagedDomainTargets(
        createApiRequester(input.brokerUrl, brokerRequestTimeoutMs),
        input.allocationId,
        input.scopedToken,
        { targets: input.targets },
      ),
    'bind managed-domain targets',
    progress,
  );
}

async function runManagedDomainRequest<TResult>(
  request: () => Promise<TResult>,
  operation: string,
  progress?: KubernetesInstallProgressReporter,
): Promise<TResult> {
  for (let attempt: number = 1; attempt <= brokerMaxAttempts; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      const failure: Error = error instanceof Error ? error : new Error('Unknown network request failure.');
      if (!isRetryableManagedDomainError(failure) || attempt === brokerMaxAttempts) {
        throw createManagedDomainError(failure, attempt, operation);
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

function createManagedDomainError(error: Error, attempts: number, operation: string): Error {
  if (isCompartmentRequestError(error)) {
    const requestId: string = error.requestId === undefined ? '' : ` (request-id: ${error.requestId})`;
    if (error.statusCode !== 429 && error.statusCode < 500) {
      return new Error(
        `Managed-domain broker ${error.method} ${error.url} failed with status ${error.statusCode.toString()}${requestId} while attempting to ${operation}. Check the install configuration before re-running install.`,
      );
    }
    return new Error(
      `Managed-domain broker ${error.method} ${error.url} failed with status ${error.statusCode.toString()}${requestId}; transient failure after ${attempts.toString()} attempts while attempting to ${operation}. Re-run install to resume.`,
    );
  }
  return new Error(
    `Managed-domain broker failed to ${operation} after ${attempts.toString()} attempts: ${error.message} This may be transient; re-run install to resume.`,
  );
}

function readRetryDelayMs(attempt: number): number {
  const exponentialDelay: number = Math.min(brokerRetryCapMs, brokerRetryBaseMs * 2 ** (attempt - 1));
  return Math.round((exponentialDelay * randomInt(800, 1_201)) / 1_000);
}

function formatDelay(delayMs: number): string {
  return `${(delayMs / 1_000).toFixed(1)}s`;
}
