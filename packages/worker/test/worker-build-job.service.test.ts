import { describe, expect, it, vi, type Mock } from 'vitest';
import type { DockerBuildImageResult, DockerProgressLine } from '@compartment/docker';
import {
  KubeJobLogAttachmentError,
  type KubeJobResult,
  type KubeJobSpec,
  type KubeRunJobOptions,
} from '@compartment/kube-runtime';
import { createWorkerTestConfig } from './worker-config-test.fixtures';
import { readWorkerBuildJobInputEnvironment, runWorkerBuildJob } from '../src/services/worker-build-job.service';
import type {
  RunWorkerRegistryVerificationBuildJobInput,
  WorkerBuildJobEnvironment,
  WorkerSourceBuildJobInput,
} from '../src/services/worker-build-job.types';

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

    const pending: Promise<DockerBuildImageResult> = runWorkerBuildJob(
      { runJob },
      createWorkerTestConfig(),
      buildInput(reporter),
    );
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
      createWorkerTestConfig(),
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
      createWorkerTestConfig(),
      buildInput((line: DockerProgressLine): void => {
        messages.push(line.message);
      }),
    );

    expect(messages).toEqual(['#1 loading', '#2 building']);
    expect(finalize).toHaveBeenCalledOnce();
  });

  it('ignores malformed streamed progress records without failing a successful build', async (): Promise<void> => {
    const finalize: Mock<() => Promise<void>> = vi.fn(async (): Promise<void> => await Promise.resolve());
    const validProgress: DockerProgressLine = { message: '#5 complete', stream: 'stdout' };
    const runJob: Mock<
      (spec: KubeJobSpec, persisted: undefined, options: KubeRunJobOptions) => Promise<KubeJobResult>
    > = vi.fn(async (_spec: KubeJobSpec, _persisted: undefined, options: KubeRunJobOptions): Promise<KubeJobResult> => {
      await options.onLogChunk?.(`${JSON.stringify({ type: 'progress' })}\n`);
      await options.onLogChunk?.(`${JSON.stringify({ progress: { stream: 'stderr' }, type: 'progress' })}\n`);
      await options.onLogChunk?.(`${JSON.stringify({ progress: validProgress, type: 'progress' })}\n`);
      return await Promise.resolve(successfulResult(finalize, '#5 complete'));
    });
    const reporter: Mock = vi.fn();

    await expect(runWorkerBuildJob({ runJob }, createWorkerTestConfig(), buildInput(reporter))).resolves.toMatchObject({
      pushed: true,
    });

    expect(reporter).toHaveBeenCalledOnce();
    expect(reporter).toHaveBeenCalledWith(validProgress);
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
        createWorkerTestConfig(),
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

    await expect(runWorkerBuildJob({ runJob }, createWorkerTestConfig(), buildInput(vi.fn()))).rejects.toThrow(
      'log connection failed',
    );
    expect(finalize).toHaveBeenCalledOnce();
  });

  it('ignores unavailable live-log attachment when the captured build succeeds', async (): Promise<void> => {
    const finalize: Mock<() => Promise<void>> = vi.fn(async (): Promise<void> => await Promise.resolve());
    const runJob: Mock<
      (spec: KubeJobSpec, persisted: undefined, options: KubeRunJobOptions) => Promise<KubeJobResult>
    > = vi.fn(async (_spec: KubeJobSpec, _persisted: undefined, options: KubeRunJobOptions): Promise<KubeJobResult> => {
      options.onLogError?.(new KubeJobLogAttachmentError(new Error('container logs unavailable')));
      return await Promise.resolve(successfulResult(finalize, '#6 done'));
    });
    const reporter: Mock = vi.fn();

    await expect(runWorkerBuildJob({ runJob }, createWorkerTestConfig(), buildInput(reporter))).resolves.toMatchObject({
      pushed: true,
    });
    expect(reporter).toHaveBeenCalledOnce();
    expect(reporter).toHaveBeenCalledWith({ message: '#6 done', stream: 'stdout' });
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
      runWorkerBuildJob({ runJob }, createWorkerTestConfig(), {
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

describe('build Job credential environment', (): void => {
  it('gives a source build Pod its scoped credential and nothing else to authenticate with', async (): Promise<void> => {
    const runJob: Mock<(spec: KubeJobSpec) => Promise<KubeJobResult>> = vi.fn(
      async (): Promise<KubeJobResult> => await Promise.resolve(successfulResult(vi.fn(), 'done')),
    );

    await runWorkerBuildJob({ runJob }, createWorkerTestConfig(), {
      build: sourceBuild(),
      id: 'art_123',
      sourceArchiveCredential: 'scoped-credential',
    });

    const env: Record<string, string> = runJob.mock.calls[0]?.[0].env ?? {};
    expect(env.COMPARTMENT_BUILD_JOB_SOURCE_ARCHIVE_CREDENTIAL).toBe('scoped-credential');
    expect(Object.keys(env)).not.toContain('COMPARTMENT_BUILD_JOB_INTERNAL_TOKEN');
  });

  it('gives a registry verification build Pod no API credential at all', async (): Promise<void> => {
    const runJob: Mock<(spec: KubeJobSpec) => Promise<KubeJobResult>> = vi.fn(
      async (): Promise<KubeJobResult> => await Promise.resolve(successfulResult(vi.fn(), 'done')),
    );

    await runWorkerBuildJob({ runJob }, createWorkerTestConfig(), { build: buildInput().build, id: 'art_123' });

    const env: Record<string, string> = runJob.mock.calls[0]?.[0].env ?? {};
    expect(Object.keys(env).sort((left: string, right: string): number => left.localeCompare(right))).toEqual([
      'BUILDKIT_ADDR',
      'COMPARTMENT_BUILD_JOB_INPUT',
      'TMPDIR',
    ]);
  });

  it('starts a registry verification runner that was given no credential', (): void => {
    expect(
      readWorkerBuildJobInputEnvironment({
        COMPARTMENT_BUILD_JOB_INPUT: JSON.stringify(buildInput().build),
      }),
    ).toMatchObject({ kind: 'registry-verification' });
  });

  it('refuses to start a runner whose build input names no known kind', (): void => {
    expect(
      (): WorkerBuildJobEnvironment => readWorkerBuildJobInputEnvironment({ COMPARTMENT_BUILD_JOB_INPUT: 'null' }),
    ).toThrow('COMPARTMENT_BUILD_JOB_INPUT must describe a known build kind.');
    expect(
      (): WorkerBuildJobEnvironment =>
        readWorkerBuildJobInputEnvironment({ COMPARTMENT_BUILD_JOB_INPUT: JSON.stringify({ kind: 'invented' }) }),
    ).toThrow('COMPARTMENT_BUILD_JOB_INPUT must describe a known build kind.');
  });

  it('refuses to start a source build runner that was given no credential', (): void => {
    expect(
      (): WorkerBuildJobEnvironment =>
        readWorkerBuildJobInputEnvironment({ COMPARTMENT_BUILD_JOB_INPUT: JSON.stringify(sourceBuild()) }),
    ).toThrow('COMPARTMENT_BUILD_JOB_SOURCE_ARCHIVE_CREDENTIAL is required for source builds.');
    expect(
      (): WorkerBuildJobEnvironment =>
        readWorkerBuildJobInputEnvironment({
          COMPARTMENT_BUILD_JOB_INPUT: JSON.stringify(sourceBuild()),
          COMPARTMENT_BUILD_JOB_SOURCE_ARCHIVE_CREDENTIAL: '',
        }),
    ).toThrow('COMPARTMENT_BUILD_JOB_SOURCE_ARCHIVE_CREDENTIAL is required for source builds.');
  });

  it('reads the scoped credential a source build runner was given', (): void => {
    expect(
      readWorkerBuildJobInputEnvironment({
        COMPARTMENT_BUILD_JOB_INPUT: JSON.stringify(sourceBuild()),
        COMPARTMENT_BUILD_JOB_SOURCE_ARCHIVE_CREDENTIAL: 'scoped-credential',
      }),
    ).toMatchObject({ kind: 'source', sourceArchiveCredential: 'scoped-credential' });
  });
});

function sourceBuild(): WorkerSourceBuildJobInput {
  return {
    apiUrl: 'http://api:39444',
    artifactId: 'art_123',
    docker: buildInput().build.docker,
    kind: 'source',
    service: {
      build: { env: [], include: [], packages: { build: [], runtime: [] }, strategy: 'auto' },
      kind: 'web',
      name: 'web',
      path: '.',
      requiresRoutesFile: false,
      run: {},
    },
  };
}

function buildInput(
  onProgressLine?: (line: DockerProgressLine) => void | Promise<void>,
): RunWorkerRegistryVerificationBuildJobInput {
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
