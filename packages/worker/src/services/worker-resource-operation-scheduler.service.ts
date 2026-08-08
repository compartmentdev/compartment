import type { WorkerRunNextScheduledResourceOperationResponse } from '@compartment/contracts';
import { runNextScheduledResourceOperation, type CompartmentRequester } from '@compartment/sdk';
import type { Logger } from 'pino';
import { buildWorkerCaughtErrorLogPayload } from '../logging/worker-error-log';
import type { WorkerCaughtError } from '../logging/worker-error-log.types';

export async function runScheduledResourceOperationIteration(
  request: CompartmentRequester,
  logger: Logger<never, boolean>,
): Promise<boolean> {
  try {
    const result: WorkerRunNextScheduledResourceOperationResponse = await runNextScheduledResourceOperation(request);
    return result.ran && !result.recordedFailure;
  } catch (error) {
    logger.error(
      buildWorkerCaughtErrorLogPayload(error as WorkerCaughtError),
      'Scheduled resource operation iteration failed. Continuing to auxiliary work.',
    );
    return false;
  }
}
