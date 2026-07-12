import type {
  ProductJobIntent,
  WorkerFinalizeProductJobRequest,
  WorkerPersistProductJobResultRequest,
} from '@compartment/contracts';
import {
  claimProductJob,
  persistProductJobIntent,
  persistProductJobFinalized,
  persistProductJobResult,
} from '../queries/product-job-runs.query';
import type { ClaimedProductJobQueryResult } from '../queries/product-job-runs.query.types';
import type { ClaimedProductJobResult } from './product-job.service.types';

export async function createProductJobIntent(input: ProductJobIntent): Promise<void> {
  await persistProductJobIntent({ identityId: readProductJobIdentity(input), intent: input });
}

export async function claimNextProductJob(): Promise<ClaimedProductJobResult> {
  const claimed: ClaimedProductJobQueryResult = await claimProductJob();
  return { intent: claimed.intent, persistedResult: claimed.persistedResult };
}

export async function completeProductJob(input: WorkerPersistProductJobResultRequest): Promise<void> {
  await persistProductJobResult(input);
}

export async function finalizeProductJob(input: WorkerFinalizeProductJobRequest): Promise<void> {
  await persistProductJobFinalized(input.jobClass, input.identityId);
}

function readProductJobIdentity(input: ProductJobIntent): string {
  return input.jobClass === 'release' ? input.deploymentId : input.operationId;
}
