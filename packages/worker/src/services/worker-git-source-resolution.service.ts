import type {
  WorkerClaimGitSourceResolutionTaskResponse,
  WorkerClaimedGitSourceResolutionTask,
  WorkerFailGitSourceResolutionTaskRequest,
} from '@compartment/contracts';
import {
  claimNextGitSourceResolutionTask,
  completeGitSourceResolutionTask,
  failGitSourceResolutionTask,
  uploadGitSourceResolutionTaskArchive,
  type CompartmentRawRequester,
  type CompartmentRequester,
} from '@compartment/sdk';
import {
  resolveGitSourceSnapshot,
  type ResolvedGitSourceSnapshot,
} from './worker-git-source-resolution-archive.service';
import { isRetryableGitSourceResolutionFailure } from './worker-git-source-resolution-failure.support';

export async function runGitSourceResolutionIteration(
  request: CompartmentRequester,
  rawRequest: CompartmentRawRequester,
): Promise<boolean> {
  const claimed: WorkerClaimGitSourceResolutionTaskResponse = await claimNextGitSourceResolutionTask(request);
  if (claimed.task === null) {
    return false;
  }

  await resolveClaimedGitSourceResolutionTask(request, rawRequest, claimed.task);
  return true;
}

async function resolveClaimedGitSourceResolutionTask(
  request: CompartmentRequester,
  rawRequest: CompartmentRawRequester,
  task: WorkerClaimedGitSourceResolutionTask,
): Promise<void> {
  try {
    const snapshot: ResolvedGitSourceSnapshot = await resolveGitSourceSnapshot(task);
    await uploadGitSourceResolutionTaskArchive(
      rawRequest,
      task.taskId,
      snapshot.normalizedArchive,
      snapshot.sourceDigest,
    );
    await completeGitSourceResolutionTask(request, {
      descriptor: snapshot.descriptor,
      ...(snapshot.routes !== undefined ? { routes: snapshot.routes } : {}),
      taskId: task.taskId,
    });
  } catch (error) {
    await reportGitSourceResolutionFailure(request, task.taskId, error instanceof Error ? error : undefined);
  }
}

async function reportGitSourceResolutionFailure(
  request: CompartmentRequester,
  taskId: string,
  failure: Error | undefined,
): Promise<void> {
  const body: WorkerFailGitSourceResolutionTaskRequest = {
    failureReason: failure?.message ?? 'Unknown git source resolution failure.',
    retryable: isRetryableGitSourceResolutionFailure(failure),
    taskId,
  };
  await failGitSourceResolutionTask(request, body);
}
