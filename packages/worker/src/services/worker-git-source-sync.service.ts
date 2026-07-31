import type {
  WorkerClaimGitSourceSyncTaskResponse,
  WorkerClaimedGitSourceSyncTask,
  WorkerFailGitSourceSyncTaskRequest,
} from '@compartment/contracts';
import {
  claimNextGitSourceSyncTask,
  completeGitSourceSyncTask,
  failGitSourceSyncTask,
  type CompartmentRequester,
} from '@compartment/sdk';
import {
  resolveGitSourceSyncDiscovery,
  type ResolvedGitSourceSyncDiscovery,
} from './worker-git-source-sync-discovery.service';
import { isRetryableGitSourceTaskError } from './worker-git-source-resolution-failure.support';

export async function runGitSourceSyncIteration(request: CompartmentRequester): Promise<boolean> {
  const claimed: WorkerClaimGitSourceSyncTaskResponse = await claimNextGitSourceSyncTask(request);
  if (claimed.task === null) {
    return false;
  }

  await resolveClaimedGitSourceSyncTask(request, claimed.task);
  return true;
}

async function resolveClaimedGitSourceSyncTask(
  request: CompartmentRequester,
  task: WorkerClaimedGitSourceSyncTask,
): Promise<void> {
  try {
    const discovery: ResolvedGitSourceSyncDiscovery = await resolveGitSourceSyncDiscovery(task);
    await completeGitSourceSyncTask(request, {
      candidates: discovery.candidates,
      claimToken: task.claimToken,
      resolvedCommitSha: discovery.resolvedCommitSha,
      taskId: task.taskId,
    });
  } catch (error) {
    await reportGitSourceSyncFailure(request, task, error instanceof Error ? error : undefined);
  }
}

async function reportGitSourceSyncFailure(
  request: CompartmentRequester,
  task: WorkerClaimedGitSourceSyncTask,
  failure: Error | undefined,
): Promise<void> {
  const body: WorkerFailGitSourceSyncTaskRequest = {
    claimToken: task.claimToken,
    failureReason: failure?.message ?? 'Unknown git source sync failure.',
    retryable: isRetryableGitSourceTaskError(failure),
    taskId: task.taskId,
  };
  await failGitSourceSyncTask(request, body);
}
