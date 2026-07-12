import { pruneBuildKitCache, type DockerBuildImageResult } from '@compartment/docker';
import type { ScheduledWorkerBuild } from './worker-build-scheduler.service.types';

const maximumConcurrentBuilds: number = 2;
const queuedBuilds: ScheduledWorkerBuild[] = [];
let batchRunning: boolean = false;
let batchStartQueued: boolean = false;

export async function scheduleWorkerBuild(run: () => Promise<DockerBuildImageResult>): Promise<DockerBuildImageResult> {
  return await new Promise<DockerBuildImageResult>(
    (resolve: (result: DockerBuildImageResult) => void, reject: (error: Error) => void): void => {
      queuedBuilds.push({ reject, resolve, run });
      queueNextBatch();
    },
  );
}

function queueNextBatch(): void {
  if (batchRunning || batchStartQueued || queuedBuilds.length === 0) {
    return;
  }

  batchStartQueued = true;
  queueMicrotask((): void => {
    batchStartQueued = false;
    void runNextBatch();
  });
}

async function runNextBatch(): Promise<void> {
  if (batchRunning) {
    return;
  }

  batchRunning = true;
  while (queuedBuilds.length > 0) {
    const batch: ScheduledWorkerBuild[] = queuedBuilds.splice(0, maximumConcurrentBuilds);
    const results: PromiseSettledResult<DockerBuildImageResult>[] = await Promise.allSettled(
      batch.map(async (build: ScheduledWorkerBuild): Promise<DockerBuildImageResult> => await build.run()),
    );
    const pruneError: Error | undefined = await pruneCompletedBuildBatch();
    if (pruneError !== undefined) {
      console.warn({ error: pruneError.message }, 'Failed to prune the BuildKit cache after a completed build batch.');
    }
    settleBatch(batch, results);
  }
  batchRunning = false;
}

async function pruneCompletedBuildBatch(): Promise<Error | undefined> {
  try {
    await pruneBuildKitCache();
    return undefined;
  } catch (error) {
    return error instanceof Error ? error : new Error('BuildKit cache pruning failed.');
  }
}

function settleBatch(batch: ScheduledWorkerBuild[], results: PromiseSettledResult<DockerBuildImageResult>[]): void {
  for (const [index, build] of batch.entries()) {
    const result: PromiseSettledResult<DockerBuildImageResult> | undefined = results[index];
    if (result?.status === 'rejected') {
      build.reject(result.reason instanceof Error ? result.reason : new Error('Image build failed.'));
    } else if (result !== undefined) {
      build.resolve(result.value);
    }
  }
}
