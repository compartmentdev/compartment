import {
  productJobIdentityId,
  type ProductJobIntent,
  type WorkerPersistProductJobResultRequest,
} from '@compartment/contracts';
import { persistProductJobResult, type CompartmentRequester } from '@compartment/sdk';

type SyntheticProductJobFailureReason = 'fencing-violation' | 'resource-not-ready';

const syntheticProductJobFailurePrefix: Record<SyntheticProductJobFailureReason, string> = {
  'fencing-violation': 'failed-before-result',
  'resource-not-ready': 'resource-not-ready',
};

/**
 * Records a terminal result for a Job that was never created, so the reason survives the worker that
 * decided it. The `jobName` prefix is the only place the reason is durable.
 */
export async function persistProductJobFailure(
  request: CompartmentRequester,
  intent: ProductJobIntent,
  reason: SyntheticProductJobFailureReason,
  failure: Error,
): Promise<void> {
  const identityId: string = productJobIdentityId(intent);
  await persistProductJobResult(request, {
    completedAt: new Date().toISOString(),
    exitCode: null,
    identityId,
    jobClass: intent.jobClass,
    jobName: `${syntheticProductJobFailurePrefix[reason]}/${identityId}`,
    logs: failure.message,
    podName: null,
    status: 'timed-out',
  } satisfies WorkerPersistProductJobResultRequest);
}
