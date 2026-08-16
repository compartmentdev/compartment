import {
  resourceReconcileLeaseHeartbeatIntervalMs,
  type WorkerAcknowledgeResourceReconcileRequest,
} from '@compartment/contracts';
import { acknowledgeResourceReconcile, type CompartmentRequester } from '@compartment/sdk';
import type { ResourceReconcileWork } from './worker-resource-reconcile.service.types';

class ResourceReconcileLeaseError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ResourceReconcileLeaseError';
  }
}

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
    if (error instanceof ResourceReconcileLeaseError) {
      throw error;
    }
    const detail: string = error instanceof Error ? `: ${error.message}` : '';
    throw new ResourceReconcileLeaseError(`Resource reconcile lease could not be renewed${detail}`);
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
      await acknowledgeCurrentResourceReconcile(request, {
        leaseId,
        operationId,
        status: 'running',
      });
    } catch (error) {
      const failure: Error =
        error instanceof Error ? error : new ResourceReconcileLeaseError('Resource reconcile lease renewal failed.');
      controller.abort(failure);
      return failure;
    }
  }
  return null;
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
