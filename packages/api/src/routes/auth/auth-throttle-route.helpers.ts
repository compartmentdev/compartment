import type { FastifyRequest } from 'fastify';
import type { ApiBoundaryError } from '../../errors/api-boundary-error';
import type { ThrottleBlock } from '../../services/throttle.service.types';
import type { AuthThrottleTrackedOperation } from './auth-throttle-route.helpers.types';

export function assertAuthThrottleAllowed(
  block: ThrottleBlock | null,
  createError: (retryAfterSeconds: number) => ApiBoundaryError,
): void {
  if (block !== null) {
    throw createError(block.retryAfterSeconds);
  }
}

export async function runWithAuthThrottleTracking<TResult>(
  request: FastifyRequest,
  operation: AuthThrottleTrackedOperation<TResult>,
): Promise<TResult> {
  try {
    const result: TResult = await operation.run();
    await runAuthThrottleSideEffectSafely(request, operation.clearSuccess, operation.clearSuccessFailureMessage);
    return result;
  } catch (error) {
    if (error instanceof Error && operation.isCountedFailure(error)) {
      await runAuthThrottleSideEffectSafely(
        request,
        operation.recordCountedFailure,
        operation.recordCountedFailureMessage,
      );
    }

    throw error;
  }
}

async function runAuthThrottleSideEffectSafely(
  request: FastifyRequest,
  effect: () => Promise<void>,
  failureMessage: string,
): Promise<void> {
  try {
    await effect();
  } catch (error) {
    request.log.warn({ error }, failureMessage);
  }
}
