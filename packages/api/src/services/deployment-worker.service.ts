import type { WorkerFailDeploymentRequest } from '@compartment/contracts';
import type { ClaimedDeploymentContext } from './deployments.service.types';
import { finalizeFailedDeployment } from './deployment-failure.service';
import { claimQueuedDeploymentForWorker as claimQueuedDeployment } from './deployment-worker-claim.service';
import { requeueOrphanedDeploymentBuildClaims } from '../queries/deployment-claim.query';

export async function claimQueuedDeploymentForWorker(): Promise<ClaimedDeploymentContext | null> {
  return await claimQueuedDeployment();
}

export async function failQueuedDeployment(input: WorkerFailDeploymentRequest): Promise<void> {
  await finalizeFailedDeployment(input);
}

export async function recoverOrphanedDeploymentBuildClaims(): Promise<number> {
  return await requeueOrphanedDeploymentBuildClaims();
}
