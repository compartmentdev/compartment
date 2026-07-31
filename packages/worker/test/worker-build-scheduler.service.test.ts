import { describe, expect, it, vi } from 'vitest';
import type { DockerBuildImageResult } from '@compartment/docker';
import { scheduleWorkerBuild } from '../src/services/worker-build-scheduler.service';

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

describe('scheduleWorkerBuild', (): void => {
  it('runs at most two build pods before starting the next batch', async (): Promise<void> => {
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
    builds[2]?.resolve('third');

    await expect(Promise.all(scheduled)).resolves.toEqual([
      { imageRef: 'first', pushed: true },
      { imageRef: 'second', pushed: true },
      { imageRef: 'third', pushed: true },
    ]);
  });

  it('releases pod capacity after a failed build', async (): Promise<void> => {
    const failed: DeferredBuild = new DeferredBuild();
    const paired: DeferredBuild = new DeferredBuild();
    const next: DeferredBuild = new DeferredBuild();
    const started: number[] = [];
    const first: Promise<DockerBuildImageResult> = scheduleTrackedBuild(failed, 0, started);
    const second: Promise<DockerBuildImageResult> = scheduleTrackedBuild(paired, 1, started);
    const third: Promise<DockerBuildImageResult> = scheduleTrackedBuild(next, 2, started);

    await vi.waitFor((): void => expect(started).toEqual([0, 1]));
    failed.reject(new Error('build failed'));
    paired.resolve('second');
    await expect(first).rejects.toThrow('build failed');
    await expect(second).resolves.toEqual({ imageRef: 'second', pushed: true });
    await vi.waitFor((): void => expect(started).toEqual([0, 1, 2]));
    next.resolve('next');
    await expect(third).resolves.toEqual({ imageRef: 'next', pushed: true });
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
