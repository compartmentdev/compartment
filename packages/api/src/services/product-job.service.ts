import type {
  ProductJobIntent,
  ProductJobClass,
  WorkerFinalizeProductJobRequest,
  WorkerPersistProductJobResultRequest,
} from '@compartment/contracts';
import { claimProductJob, persistProductJobFinalized } from '../queries/product-job-runs.query';
import { persistProductJobResult } from '../queries/product-job-result.query';
import { persistProductJobIntent } from '../queries/product-job-intent.query';
import type { ClaimedProductJobQueryResult } from '../queries/product-job-runs.query.types';
import type { ClaimedProductJobResult } from './product-job.service.types';

export async function createProductJobIntent(
  input: ProductJobIntent,
): Promise<WorkerPersistProductJobResultRequest | null> {
  return await persistProductJobIntent({ identityId: readProductJobIdentity(input), intent: input });
}

export async function claimNextProductJob(jobClass: ProductJobClass): Promise<ClaimedProductJobResult> {
  const claimed: ClaimedProductJobQueryResult = await claimProductJob(jobClass);
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
