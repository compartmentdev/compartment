import {
  resourceReconcileLeaseHeartbeatIntervalMs,
  type WorkerAcknowledgeResourceReconcileRequest,
} from '@compartment/contracts';
import {
  acknowledgeResourceReconcile,
  isCompartmentRequestError,
  isRetryableRequestError,
  type CompartmentRequester,
} from '@compartment/sdk';
import type { ResourceReconcileWork } from './worker-resource-reconcile.service.types';

class ResourceReconcileLeaseError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ResourceReconcileLeaseError';
  }
}

const resourceReconcileHeartbeatAttemptLimit: number = 3;
const resourceReconcileHeartbeatRetryDelayMs: number = 1_000;

export function rethrowResourceReconcileLeaseError(error: object | null): void {
  if (error instanceof ResourceReconcileLeaseError) {
    throw error;
  }
}

export async function acknowledgeCurrentResourceReconcile(
  request: CompartmentRequester,
  input: WorkerAcknowledgeResourceReconcileRequest,
): Promise<void> {
  try {
    await acknowledgeResourceReconcile(request, input);
  } catch (error) {
    const failure: Error = error instanceof Error ? error : new Error('Resource reconcile acknowledgement failed.');
    if (isCompartmentRequestError(failure) && failure.statusCode === 409) {
      throw new ResourceReconcileLeaseError('Resource reconcile lease is no longer current.');
    }
    throw failure;
  }
}

export async function runWithResourceReconcileLease(
  request: CompartmentRequester,
  leaseId: string,
  operationId: string,
  work: ResourceReconcileWork,
): Promise<void> {
  const controller: AbortController = new AbortController();
  const heartbeat: Promise<Error | null> = maintainResourceReconcileLease(request, leaseId, operationId, controller);
  const workError: Error | null = await captureResourceReconcileWorkError(work, controller.signal);
  controller.abort();
  const heartbeatError: Error | null = await heartbeat;
  if (workError !== null) {
    throw workError;
  }
  if (heartbeatError !== null) {
    throw heartbeatError;
  }
}

async function captureResourceReconcileWorkError(
  work: ResourceReconcileWork,
  signal: AbortSignal,
): Promise<Error | null> {
  try {
    await work(signal);
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error('Resource reconcile work failed.');
  }
}

async function maintainResourceReconcileLease(
  request: CompartmentRequester,
  leaseId: string,
  operationId: string,
  controller: AbortController,
): Promise<Error | null> {
  while (await waitForHeartbeat(controller.signal)) {
    try {
      await renewResourceReconcileLease(request, leaseId, operationId, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) {
        return null;
      }
      const failure: Error = error instanceof Error ? error : new Error('Resource reconcile lease renewal failed.');
      const leaseFailure: ResourceReconcileLeaseError =
        failure instanceof ResourceReconcileLeaseError
          ? failure
          : new ResourceReconcileLeaseError(
              `Resource reconcile lease could not be renewed after ${resourceReconcileHeartbeatAttemptLimit} attempts: ${failure.message}`,
            );
      controller.abort(leaseFailure);
      return leaseFailure;
    }
  }
  return null;
}

async function renewResourceReconcileLease(
  request: CompartmentRequester,
  leaseId: string,
  operationId: string,
  signal: AbortSignal,
): Promise<void> {
  for (let attempt: number = 1; attempt <= resourceReconcileHeartbeatAttemptLimit; attempt += 1) {
    try {
      await acknowledgeCurrentResourceReconcile(request, { leaseId, operationId, status: 'running' });
      return;
    } catch (error) {
      const failure: Error = error instanceof Error ? error : new Error('Resource reconcile lease renewal failed.');
      if (
        failure instanceof ResourceReconcileLeaseError ||
        attempt === resourceReconcileHeartbeatAttemptLimit ||
        !isRetryableRequestError(failure)
      ) {
        throw failure;
      }
      await waitForHeartbeatRetry(signal);
    }
  }
}

async function waitForHeartbeatRetry(signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
    const abort: () => void = (): void => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new Error('Resource reconcile heartbeat was aborted.'));
    };
    const timer: NodeJS.Timeout = setTimeout((): void => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, resourceReconcileHeartbeatRetryDelayMs);
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function waitForHeartbeat(signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) {
    return false;
  }
  return await new Promise<boolean>((resolve: (continueHeartbeat: boolean) => void): void => {
    const stop: () => void = (): void => {
      clearTimeout(timeout);
      resolve(false);
    };
    const heartbeat: () => void = (): void => {
      signal.removeEventListener('abort', stop);
      resolve(true);
    };
    const timeout: NodeJS.Timeout = setTimeout(heartbeat, resourceReconcileLeaseHeartbeatIntervalMs);
    signal.addEventListener('abort', stop, { once: true });
  });
}
