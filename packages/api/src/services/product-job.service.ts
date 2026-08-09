import {
  productJobIdentityId,
  type ProductJobIntent,
  type ProductJobClass,
  type WorkerFinalizeProductJobRequest,
  type WorkerPersistProductJobResultRequest,
  type WorkerSubmitProductJobRequest,
} from '@compartment/contracts';
import { claimProductJob, persistProductJobFinalized } from '../queries/product-job-runs.query';
import { persistProductJobKubeSubmission } from '../queries/product-job-kube-submission.query';
import { persistProductJobResult } from '../queries/product-job-result.query';
import { persistProductJobIntent } from '../queries/product-job-intent.query';
import type { ClaimedProductJobQueryResult } from '../queries/product-job-runs.query.types';
import type { ClaimedProductJobResult } from './product-job.service.types';

export async function createProductJobIntent(
  input: ProductJobIntent,
): Promise<WorkerPersistProductJobResultRequest | null> {
  return await persistProductJobIntent({ identityId: productJobIdentityId(input), intent: input });
}

export async function claimNextProductJob(jobClass: ProductJobClass): Promise<ClaimedProductJobResult> {
  const claimed: ClaimedProductJobQueryResult = await claimProductJob(jobClass);
  return {
    intent: claimed.intent,
    persistedResult: claimed.persistedResult,
    resourceReadiness: claimed.resourceReadiness,
  };
}

export async function completeProductJob(input: WorkerPersistProductJobResultRequest): Promise<void> {
  await persistProductJobResult(input);
}

export async function finalizeProductJob(input: WorkerFinalizeProductJobRequest): Promise<void> {
  await persistProductJobFinalized(input.jobClass, input.identityId);
}

/** True when the worker may hand the manifest to the API server; false when a reconcile owns one of its resources. */
export async function submitProductJob(input: WorkerSubmitProductJobRequest): Promise<boolean> {
  return await persistProductJobKubeSubmission(input.jobClass, input.identityId);
}
