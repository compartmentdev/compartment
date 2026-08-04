import { describe, expect, it, vi, type Mock } from 'vitest';
import type { DockerBuildImageResult, DockerProgressLine } from '@compartment/docker';
import type { KubeJobResult, KubeJobSpec, KubeRunJobOptions } from '@compartment/kube-runtime';
import type { WorkerBuildSandboxConfig } from '../src/config';
import { runWorkerBuildJob } from '../src/services/worker-build-job.service';
import type { RunWorkerBuildJobInput } from '../src/services/worker-build-job.types';

describe('runWorkerBuildJob', (): void => {
  it('publishes streamed progress before the Kubernetes Job completes without replaying it', async (): Promise<void> => {
    let completeJob: ((result: KubeJobResult) => void) | undefined;
    const finalize: Mock<() => Promise<void>> = vi.fn(async (): Promise<void> => await Promise.resolve());
    const runJob: Mock<
      (spec: KubeJobSpec, persisted: undefined, options: KubeRunJobOptions) => Promise<KubeJobResult>
    > = vi.fn(async (_spec: KubeJobSpec, _persisted: undefined, options: KubeRunJobOptions): Promise<KubeJobResult> => {
      await options.onLogChunk?.(
        `${JSON.stringify({ progress: { message: '#1 loading', stream: 'stdout' }, type: 'progress' })}\n`,
      );
      return await new Promise<KubeJobResult>((resolve: (result: KubeJobResult) => void): void => {
        completeJob = resolve;
      });
    });
    const reporter: Mock = vi.fn();

    const pending: Promise<DockerBuildImageResult> = runWorkerBuildJob({ runJob }, buildConfig(), buildInput(reporter));
    await vi.waitFor((): void => expect(reporter).toHaveBeenCalledWith({ message: '#1 loading', stream: 'stdout' }));
    await vi.waitFor((): void => expect(completeJob).toBeDefined());
    expect(finalize).not.toHaveBeenCalled();

    completeJob?.(successfulResult(finalize, '#1 loading'));
    await expect(pending).resolves.toMatchObject({ pushed: true });
    expect(reporter).toHaveBeenCalledOnce();
    expect(finalize).toHaveBeenCalledOnce();
  });

  it('drains chunked progress in order before resolving and finalizing', async (): Promise<void> => {
    const events: string[] = [];
    const finalize: Mock<() => Promise<void>> = vi.fn(async (): Promise<void> => {
      await Promise.resolve();
      events.push('finalize');
    });
    const progressRecord: string = JSON.stringify({
      progress: { message: '#2 building', stream: 'stderr' },
      type: 'progress',
    });
    const runJob: Mock<
      (spec: KubeJobSpec, persisted: undefined, options: KubeRunJobOptions) => Promise<KubeJobResult>
    > = vi.fn(async (_spec: KubeJobSpec, _persisted: undefined, options: KubeRunJobOptions): Promise<KubeJobResult> => {
      await options.onLogChunk?.(progressRecord.slice(0, 20));
      await options.onLogChunk?.(`${progressRecord.slice(20)}\n`);
      return await Promise.resolve(successfulResult(finalize, '#2 building', 'stderr'));
    });

    await runWorkerBuildJob(
      { runJob },
      buildConfig(),
      buildInput(async (): Promise<void> => {
        await Promise.resolve();
        events.push('progress');
      }),
    );

    expect(events).toEqual(['progress', 'finalize']);
  });

  it('publishes a final unterminated streamed record once before finalization', async (): Promise<void> => {
    const messages: string[] = [];
    const finalize: Mock<() => Promise<void>> = vi.fn(async (): Promise<void> => await Promise.resolve());
    const first: string = JSON.stringify({ progress: { message: '#1 loading', stream: 'stdout' }, type: 'progress' });
    const second: string = JSON.stringify({ progress: { message: '#2 building', stream: 'stderr' }, type: 'progress' });
    const runJob: Mock<
      (spec: KubeJobSpec, persisted: undefined, options: KubeRunJobOptions) => Promise<KubeJobResult>
    > = vi.fn(async (_spec: KubeJobSpec, _persisted: undefined, options: KubeRunJobOptions): Promise<KubeJobResult> => {
      await options.onLogChunk?.(`${first}\n${second}`);
      const result: KubeJobResult = successfulResult(finalize, '#2 building', 'stderr');
      return { ...result, logs: `${first}\n${second}\n${result.logs.split('\n').at(-2)}\n` };
    });

    await runWorkerBuildJob(
      { runJob },
      buildConfig(),
      buildInput((line: DockerProgressLine): void => {
        messages.push(line.message);
      }),
    );

    expect(messages).toEqual(['#1 loading', '#2 building']);
    expect(finalize).toHaveBeenCalledOnce();
  });

  it('finalizes after a progress reporter failure', async (): Promise<void> => {
    const finalize: Mock<() => Promise<void>> = vi.fn(async (): Promise<void> => await Promise.resolve());
    const runJob: Mock<
      (spec: KubeJobSpec, persisted: undefined, options: KubeRunJobOptions) => Promise<KubeJobResult>
    > = vi.fn(async (_spec: KubeJobSpec, _persisted: undefined, options: KubeRunJobOptions): Promise<KubeJobResult> => {
      try {
        await options.onLogChunk?.(
          `${JSON.stringify({ progress: { message: '#3 pushing', stream: 'stdout' }, type: 'progress' })}\n`,
        );
      } catch (error) {
        options.onLogError?.(error as Error);
      }
      return await Promise.resolve(successfulResult(finalize, '#3 pushing'));
    });

    await expect(
      runWorkerBuildJob(
        { runJob },
        buildConfig(),
        buildInput(async (): Promise<void> => {
          await Promise.resolve();
          throw new Error('event publication failed');
        }),
      ),
    ).rejects.toThrow('event publication failed');
    expect(finalize).toHaveBeenCalledOnce();
  });

  it('finalizes after a Kubernetes log stream failure', async (): Promise<void> => {
    const finalize: Mock<() => Promise<void>> = vi.fn(async (): Promise<void> => await Promise.resolve());
    const runJob: Mock<
      (spec: KubeJobSpec, persisted: undefined, options: KubeRunJobOptions) => Promise<KubeJobResult>
    > = vi.fn(async (_spec: KubeJobSpec, _persisted: undefined, options: KubeRunJobOptions): Promise<KubeJobResult> => {
      options.onLogError?.(new Error('log connection failed'));
      return await Promise.resolve(successfulResult(finalize, '#4 done'));
    });

    await expect(runWorkerBuildJob({ runJob }, buildConfig(), buildInput(vi.fn()))).rejects.toThrow(
      'log connection failed',
    );
    expect(finalize).toHaveBeenCalledOnce();
  });

  it('runs a deterministic gVisor Job with an ephemeral rootless BuildKit sidecar and deletes it after capture', async (): Promise<void> => {
    const finalize: Mock<() => Promise<void>> = vi.fn(async (): Promise<void> => await Promise.resolve());
    const runJob: Mock<
      (spec: KubeJobSpec, persisted?: undefined, options?: KubeRunJobOptions) => Promise<KubeJobResult>
    > = vi.fn(
      async (): Promise<KubeJobResult> =>
        await Promise.resolve({
          completedAt: new Date(),
          exitCode: 0,
          finalize,
          jobName: 'job-art-123',
          logs: `${JSON.stringify({
            result: { imageRef: `registry.example/web@sha256:${'a'.repeat(64)}`, pushed: true },
            type: 'result',
          })}\n`,
          podName: 'job-art-123-pod',
          status: 'succeeded',
        }),
    );

    await expect(
      runWorkerBuildJob({ runJob }, buildConfig(), {
        build: {
          docker: {
            imageTag: 'registry.example/web:art_123',
            labels: {},
            pushImageInsecureRegistry: false,
            pushImageTag: 'registry.internal/web:art_123',
            pushRegistryCredentials: { password: 'secret', serverAddress: 'registry.internal', username: 'build' },
          },
          dockerfile: 'FROM scratch\n',
          kind: 'registry-verification',
        },
        id: 'art_123',
        internalToken: 'runtime-control-token',
      }),
    ).resolves.toEqual({
      imageRef: `registry.example/web@sha256:${'a'.repeat(64)}`,
      pushed: true,
    });

    const spec: KubeJobSpec = runJob.mock.calls[0]![0];
    expect(runJob.mock.calls[0]![2]).toBeUndefined();
    expect(spec).toMatchObject({
      cleanupPolicy: 'delete',
      id: 'art_123',
      jobClass: 'build',
      labels: { 'compartment.dev/job-class': 'build' },
      namespace: 'compartment-build',
      priorityClassName: 'compartment-platform',
      scheduling: { runtimeClassName: 'gvisor' },
      sidecars: [
        {
          image: 'moby/buildkit@sha256:builder',
          name: 'buildkit',
          securityProfile: 'rootless-buildkit',
        },
      ],
    });
    expect(spec.sidecars?.[0]?.args).toContain('--oci-worker-snapshotter=native');
    expect(spec.volumeMounts).toBeUndefined();
    expect(spec.emptyDirVolumes).toEqual(
      expect.arrayContaining([{ name: 'buildkit-data' }, { containerMountPath: '/tmp', name: 'tmp' }]),
    );
    expect(finalize).toHaveBeenCalledOnce();
  });

  it('reports a structured runner failure and still deletes the Job', async (): Promise<void> => {
    const finalize: Mock<() => Promise<void>> = vi.fn(async (): Promise<void> => await Promise.resolve());
    const runJob: Mock<(spec: KubeJobSpec) => Promise<KubeJobResult>> = vi.fn(
      async (): Promise<KubeJobResult> =>
        await Promise.resolve({
          completedAt: new Date(),
          exitCode: 1,
          finalize,
          jobName: 'job-art-123',
          logs:
            `${JSON.stringify({ progress: { message: '#12 exporting cache', stream: 'stdout' }, type: 'progress' })}\n` +
            `${JSON.stringify({ progress: { message: 'failed to push: connection reset', stream: 'stderr' }, type: 'progress' })}\n` +
            `${JSON.stringify({ message: 'buildctl failed', type: 'failure' })}\n`,
          podName: 'job-art-123-pod',
          status: 'failed',
        }),
    );

    await expect(
      runWorkerBuildJob({ runJob }, buildConfig(), {
        build: {
          docker: {
            imageTag: 'registry.example/web:art_123',
            labels: {},
            pushImageInsecureRegistry: false,
            pushImageTag: 'registry.internal/web:art_123',
            pushRegistryCredentials: { password: 'secret', serverAddress: 'registry.internal', username: 'build' },
          },
          dockerfile: 'FROM scratch\n',
          kind: 'registry-verification',
        },
        id: 'art_123',
        internalToken: 'runtime-control-token',
      }),
    ).rejects.toThrow(
      'Sandboxed build Job job-art-123 failed: buildctl failed\n' +
        'BuildKit terminal output:\n' +
        '[stdout] #12 exporting cache\n' +
        '[stderr] failed to push: connection reset',
    );
    expect(finalize).toHaveBeenCalledOnce();
  });
});

function buildConfig(): WorkerBuildSandboxConfig {
  return {
    buildKitImage: 'moby/buildkit@sha256:builder',
    buildKitResources: {},
    gcKeepStorageMb: 2000,
    namespace: 'compartment-build',
    runnerImage: 'compartment-worker@sha256:runner',
    runnerResources: {},
    scheduling: { nodeSelector: {}, runtimeClassName: 'gvisor', tolerations: [] },
    timeoutMs: 900000,
  };
}

function buildInput(onProgressLine?: (line: DockerProgressLine) => void | Promise<void>): RunWorkerBuildJobInput {
  return {
    build: {
      docker: {
        imageTag: 'registry.example/web:art_123',
        labels: {},
        pushImageInsecureRegistry: false,
        pushImageTag: 'registry.internal/web:art_123',
        pushRegistryCredentials: { password: 'secret', serverAddress: 'registry.internal', username: 'build' },
      },
      dockerfile: 'FROM scratch\n',
      kind: 'registry-verification',
    },
    id: 'art_123',
    internalToken: 'runtime-control-token',
    onProgressLine,
  };
}

function successfulResult(
  finalize: () => Promise<void>,
  progressMessage: string,
  stream: 'stderr' | 'stdout' = 'stdout',
): KubeJobResult {
  return {
    completedAt: new Date(),
    exitCode: 0,
    finalize,
    jobName: 'job-art-123',
    logs:
      `${JSON.stringify({ progress: { message: progressMessage, stream }, type: 'progress' })}\n` +
      `${JSON.stringify({
        result: { imageRef: `registry.example/web@sha256:${'a'.repeat(64)}`, pushed: true },
        type: 'result',
      })}\n`,
    podName: 'job-art-123-pod',
    status: 'succeeded',
  };
}
