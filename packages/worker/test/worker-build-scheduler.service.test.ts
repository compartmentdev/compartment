import { afterEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';
import type { DockerBuildImageResult } from '@compartment/docker';
import { scheduleWorkerBuild } from '../src/services/worker-build-scheduler.service';

type PruneBuildKitCache = () => Promise<void>;

interface WorkerBuildSchedulerMocks {
  pruneBuildKitCache: Mock<PruneBuildKitCache>;
}

class DeferredBuild {
  readonly promise: Promise<DockerBuildImageResult>;
  private rejectBuild: (error: Error) => void = (): void => undefined;
  private resolveBuild: (result: DockerBuildImageResult) => void = (): void => undefined;

  constructor() {
    this.promise = new Promise<DockerBuildImageResult>(
      (resolve: (result: DockerBuildImageResult) => void, reject: (error: Error) => void): void => {
        this.rejectBuild = reject;
        this.resolveBuild = resolve;
      },
    );
  }

  reject(error: Error): void {
    this.rejectBuild(error);
  }

  resolve(imageRef: string): void {
    this.resolveBuild({ imageRef, pushed: true });
  }
}

const mocks: WorkerBuildSchedulerMocks = vi.hoisted(
  (): WorkerBuildSchedulerMocks => ({ pruneBuildKitCache: vi.fn<PruneBuildKitCache>() }),
);

vi.mock('@compartment/docker', (): { pruneBuildKitCache: Mock<PruneBuildKitCache> } => ({
  pruneBuildKitCache: mocks.pruneBuildKitCache,
}));

afterEach((): void => {
  mocks.pruneBuildKitCache.mockReset();
  vi.restoreAllMocks();
});

describe('scheduleWorkerBuild', (): void => {
  it('runs at most two builds and prunes before starting the next batch', async (): Promise<void> => {
    mocks.pruneBuildKitCache.mockResolvedValue(undefined);
    const builds: DeferredBuild[] = [new DeferredBuild(), new DeferredBuild(), new DeferredBuild()];
    const started: number[] = [];
    const scheduled: Promise<DockerBuildImageResult>[] = builds.map(
      async (build: DeferredBuild, index: number): Promise<DockerBuildImageResult> =>
        await scheduleWorkerBuild(async (): Promise<DockerBuildImageResult> => {
          started.push(index);
          return await build.promise;
        }),
    );
    await vi.waitFor((): void => expect(started).toEqual([0, 1]));

    builds[0]?.resolve('first');
    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    builds[1]?.resolve('second');
    await vi.waitFor((): void => expect(started).toEqual([0, 1, 2]));

    expect(mocks.pruneBuildKitCache).toHaveBeenCalledTimes(1);
    builds[2]?.resolve('third');
    await expect(Promise.all(scheduled)).resolves.toEqual([
      { imageRef: 'first', pushed: true },
      { imageRef: 'second', pushed: true },
      { imageRef: 'third', pushed: true },
    ]);
    expect(mocks.pruneBuildKitCache).toHaveBeenCalledTimes(2);
  });

  it('releases capacity after failure so the next build succeeds', async (): Promise<void> => {
    mocks.pruneBuildKitCache.mockResolvedValue(undefined);
    const failed: DeferredBuild = new DeferredBuild();
    const paired: DeferredBuild = new DeferredBuild();
    const next: DeferredBuild = new DeferredBuild();
    const first: Promise<DockerBuildImageResult> = scheduleWorkerBuild(
      async (): Promise<DockerBuildImageResult> => await failed.promise,
    );
    const firstResult: Promise<void> = expect(first).rejects.toThrow('build failed');
    const second: Promise<DockerBuildImageResult> = scheduleWorkerBuild(
      async (): Promise<DockerBuildImageResult> => await paired.promise,
    );
    const third: Promise<DockerBuildImageResult> = scheduleWorkerBuild(
      async (): Promise<DockerBuildImageResult> => await next.promise,
    );

    failed.reject(new Error('build failed'));
    paired.resolve('second');
    await firstResult;
    await expect(second).resolves.toEqual({ imageRef: 'second', pushed: true });
    await vi.waitFor((): void => expect(mocks.pruneBuildKitCache).toHaveBeenCalledTimes(1));
    next.resolve('next succeeded');

    await expect(third).resolves.toEqual({ imageRef: 'next succeeded', pushed: true });
    expect(mocks.pruneBuildKitCache).toHaveBeenCalledTimes(2);
  });

  it('reports prune failure without failing completed builds or blocking the queued batch', async (): Promise<void> => {
    const warnSpy: MockInstance<typeof console.warn> = vi
      .spyOn(console, 'warn')
      .mockImplementation((): void => undefined);
    const pruneError: Error = new Error('build cache prune failed');
    mocks.pruneBuildKitCache.mockRejectedValueOnce(pruneError).mockResolvedValueOnce(undefined);
    const first: DeferredBuild = new DeferredBuild();
    const second: DeferredBuild = new DeferredBuild();
    const next: DeferredBuild = new DeferredBuild();
    const started: number[] = [];
    const firstResult: Promise<DockerBuildImageResult> = scheduleTrackedBuild(first, 0, started);
    const secondResult: Promise<DockerBuildImageResult> = scheduleTrackedBuild(second, 1, started);
    const nextResult: Promise<DockerBuildImageResult> = scheduleTrackedBuild(next, 2, started);
    await vi.waitFor((): void => expect(started).toEqual([0, 1]));

    first.resolve('first');
    second.resolve('second');
    await expect(firstResult).resolves.toEqual({ imageRef: 'first', pushed: true });
    await expect(secondResult).resolves.toEqual({ imageRef: 'second', pushed: true });
    await vi.waitFor((): void => expect(started).toEqual([0, 1, 2]));
    next.resolve('next succeeded');

    await expect(nextResult).resolves.toEqual({ imageRef: 'next succeeded', pushed: true });
    expect(mocks.pruneBuildKitCache).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      { error: 'build cache prune failed' },
      'Failed to prune the BuildKit cache after a completed build batch.',
    );
  });
});

async function scheduleTrackedBuild(
  build: DeferredBuild,
  index: number,
  started: number[],
): Promise<DockerBuildImageResult> {
  return await scheduleWorkerBuild(async (): Promise<DockerBuildImageResult> => {
    started.push(index);
    return await build.promise;
  });
}
