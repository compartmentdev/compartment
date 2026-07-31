import type { WorkerClaimDeploymentRequest, WorkerFailDeploymentRequest } from '@compartment/contracts';
import type { ClaimedDeploymentBuildQueueResult } from './deployment-worker-claim.service.types';
import { finalizeFailedDeployment } from './deployment-failure.service';
import { claimQueuedDeploymentForWorker as claimQueuedDeployment } from './deployment-worker-claim.service';
import { requeueOrphanedDeploymentBuildClaims } from '../queries/deployment-claim.query';

export async function claimQueuedDeploymentForWorker(
  input: WorkerClaimDeploymentRequest,
): Promise<ClaimedDeploymentBuildQueueResult> {
  return await claimQueuedDeployment(input);
}

export async function failQueuedDeployment(input: WorkerFailDeploymentRequest): Promise<void> {
  await finalizeFailedDeployment(input);
}

export async function recoverOrphanedDeploymentBuildClaims(claimTimeoutMs: number): Promise<number> {
  return await requeueOrphanedDeploymentBuildClaims(new Date(Date.now() - claimTimeoutMs));
}
