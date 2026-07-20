import type {
  ProductJobIntent,
  WorkerFinalizeProductJobRequest,
  WorkerPersistProductJobIntentResponse,
  WorkerPersistProductJobResultRequest,
} from '@compartment/contracts';
import type { KubeJobResult, KubeObservedManifest, KubeRuntime } from '@compartment/kube-runtime';
import type { CompartmentRequester } from '@compartment/sdk';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { executeProductJob } from '../src/services/worker-product-job.service';

interface ProductJobSdkMocks {
  finalize: Mock<
    (request: CompartmentRequester, input: WorkerFinalizeProductJobRequest) => Promise<WorkerFinalizeProductJobRequest>
  >;
  persistIntent: Mock<
    (request: CompartmentRequester, intent: ProductJobIntent) => Promise<WorkerPersistProductJobIntentResponse>
  >;
  persistResult: Mock<
    (
      request: CompartmentRequester,
      result: WorkerPersistProductJobResultRequest,
    ) => Promise<WorkerPersistProductJobResultRequest>
  >;
}

const mocks: ProductJobSdkMocks = vi.hoisted(
  (): ProductJobSdkMocks => ({ finalize: vi.fn(), persistIntent: vi.fn(), persistResult: vi.fn() }),
);

vi.mock('@compartment/sdk', (): object => ({
  finalizeProductJob: mocks.finalize,
  persistProductJobIntent: mocks.persistIntent,
  persistProductJobResult: mocks.persistResult,
}));

describe('executeProductJob', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    mocks.finalize.mockImplementation(
      async (
        _request: CompartmentRequester,
        input: WorkerFinalizeProductJobRequest,
      ): Promise<WorkerFinalizeProductJobRequest> => await Promise.resolve(input),
    );
    mocks.persistIntent.mockImplementation(
      async (): Promise<WorkerPersistProductJobIntentResponse> => await Promise.resolve({ result: null }),
    );
    mocks.persistResult.mockImplementation(
      async (
        _request: CompartmentRequester,
        result: WorkerPersistProductJobResultRequest,
      ): Promise<WorkerPersistProductJobResultRequest> => await Promise.resolve(result),
    );
  });

  it('persists intent before Kubernetes creation and stops when intent persistence fails', async (): Promise<void> => {
    const runtime: KubeRuntime & { runJob: Mock } = runtimeWithResult(successResult());
    mocks.persistIntent.mockRejectedValue(new Error('database unavailable'));

    await expect(executeProductJob(requester(), runtime, releaseIntent())).rejects.toThrow('database unavailable');

    expect(runtime.runJob.mock.calls).toHaveLength(0);
  });

  it('does not create Kubernetes work when the API has already canceled the intent', async (): Promise<void> => {
    const runtime: KubeRuntime & { runJob: Mock } = runtimeWithResult(successResult());
    mocks.persistIntent.mockResolvedValue({
      result: {
        completedAt: '2026-07-12T12:00:00.000Z',
        exitCode: null,
        identityId: 'dep-01jz',
        jobClass: 'release',
        jobName: 'archived-job/dep-01jz',
        logs: 'project archived',
        podName: null,
        status: 'timed-out',
      },
    });

    await expect(executeProductJob(requester(), runtime, releaseIntent())).rejects.toThrow(
      'Product release job dep-01jz timed out.',
    );

    expect(runtime.runJob).not.toHaveBeenCalled();
  });

  it('persists full terminal evidence before enabling TTL cleanup', async (): Promise<void> => {
    let durable: boolean = false;
    mocks.persistResult.mockImplementation(
      async (
        _request: CompartmentRequester,
        result: WorkerPersistProductJobResultRequest,
      ): Promise<WorkerPersistProductJobResultRequest> => {
        durable = true;
        return await Promise.resolve(result);
      },
    );
    const result: KubeJobResult = {
      ...successResult(),
      finalize: vi.fn(async (): Promise<void> => {
        if (!durable) {
          throw new Error('TTL enabled before durable evidence.');
        }
        await Promise.resolve();
      }),
    };
    const runtime: KubeRuntime & { runJob: Mock } = runtimeWithResult(result);

    await executeProductJob(requester(), runtime, releaseIntent());

    expect(mocks.persistResult).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ exitCode: 0, logs: 'complete output\n', status: 'succeeded' }),
    );
    expect((result.finalize as Mock).mock.calls).toHaveLength(1);
    expect(durable).toBe(true);
  });

  it('leaves a transient Kubernetes failure non-terminal and retries the same Job identity', async (): Promise<void> => {
    const result: KubeJobResult = successResult();
    const runtime: KubeRuntime & { runJob: Mock } = runtimeWithSequence([
      new Error('observation startup unavailable'),
      result,
    ]);
    const intent: ProductJobIntent = releaseIntent();

    await expect(executeProductJob(requester(), runtime, intent)).rejects.toThrow('observation startup unavailable');

    expect(mocks.persistResult).not.toHaveBeenCalled();

    await expect(executeProductJob(requester(), runtime, intent)).resolves.toMatchObject({ status: 'succeeded' });

    expect(runtime.runJob).toHaveBeenCalledTimes(2);
    expect(runtime.runJob.mock.calls[1]?.[0]).toEqual(runtime.runJob.mock.calls[0]?.[0]);
    expect(mocks.persistResult).toHaveBeenCalledOnce();
    expect(mocks.persistResult).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ identityId: 'dep-01jz', status: 'succeeded' }),
    );
    expect((result.finalize as Mock).mock.calls).toHaveLength(1);
  });

  it('does not finalize when killed after terminal capture and before persistence', async (): Promise<void> => {
    const result: KubeJobResult = successResult();
    mocks.persistResult.mockRejectedValue(new Error('worker killed'));

    await expect(executeProductJob(requester(), runtimeWithResult(result), releaseIntent())).rejects.toThrow(
      'worker killed',
    );

    expect((result.finalize as Mock).mock.calls).toHaveLength(0);
  });

  it('persists a failed exit and full logs before rejecting the product flow', async (): Promise<void> => {
    const result: KubeJobResult = { ...successResult(), exitCode: 19, status: 'failed' };

    await expect(executeProductJob(requester(), runtimeWithResult(result), releaseIntent())).rejects.toThrow(
      'Product release job dep-01jz failed.',
    );

    expect((result.finalize as Mock).mock.calls).toHaveLength(1);
  });

  it('persists timeout partial logs before rejecting the product flow', async (): Promise<void> => {
    const result: KubeJobResult = {
      ...successResult(),
      exitCode: null,
      logs: 'partial output\n',
      podName: null,
      status: 'timed-out',
    };

    await expect(executeProductJob(requester(), runtimeWithResult(result), releaseIntent())).rejects.toThrow(
      'Product release job dep-01jz timed out.',
    );

    expect(mocks.persistResult).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ exitCode: null, logs: 'partial output\n', podName: null, status: 'timed-out' }),
    );
  });

  it('fences a pending WaitForFirstConsumer PVC through a live read before creating the Job', async (): Promise<void> => {
    const runtime: KubeRuntime & { runJob: Mock } = runtimeWithResult(successResult());
    const read: Mock = vi.fn(
      async (): Promise<KubeObservedManifest> =>
        await Promise.resolve({
          apiVersion: 'v1',
          kind: 'PersistentVolumeClaim',
          metadata: { name: 'backup-artifacts', uid: 'uid-backup' },
          status: { phase: 'Pending' },
        }),
    );
    runtime.read = read;
    const intent: ProductJobIntent = resourceOperationIntent();

    await executeProductJob(requester(), runtime, intent);

    expect(read).toHaveBeenCalledWith({
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: { name: 'backup-artifacts', namespace: 'cpt-prj-01jz' },
    });
    expect(runtime.runJob).toHaveBeenCalledWith(expect.objectContaining({ volumeMounts: intent.volumeMounts }));
  });

  it('durably terminates a Job intent when its mounted PVC identity is fenced', async (): Promise<void> => {
    const runtime: KubeRuntime & { runJob: Mock } = runtimeWithResult(successResult());
    runtime.read = vi.fn(
      async (): Promise<KubeObservedManifest> =>
        await Promise.resolve({
          apiVersion: 'v1',
          kind: 'PersistentVolumeClaim',
          metadata: { name: 'backup-artifacts', uid: 'replacement-uid' },
          status: { phase: 'Bound' },
        }),
    );
    const intent: ProductJobIntent = resourceOperationIntent();

    await expect(executeProductJob(requester(), runtime, intent)).rejects.toThrow('PVC backup-artifacts UID changed');

    expect(runtime.runJob).not.toHaveBeenCalled();
    const persisted: WorkerPersistProductJobResultRequest | undefined = mocks.persistResult.mock.calls[0]?.[1];
    expect(persisted).toMatchObject({ identityId: 'operation-1', status: 'timed-out' });
    expect(persisted?.logs).toContain('PVC backup-artifacts UID changed');
  });

  it('leaves a mounted Job intent non-terminal when the PVC read is transiently unavailable', async (): Promise<void> => {
    const runtime: KubeRuntime & { runJob: Mock } = runtimeWithResult(successResult());
    runtime.read = vi.fn(async (): Promise<never> => await Promise.reject(new Error('PVC read unavailable')));

    await expect(executeProductJob(requester(), runtime, resourceOperationIntent())).rejects.toThrow(
      'PVC read unavailable',
    );

    expect(runtime.runJob).not.toHaveBeenCalled();
    expect(mocks.persistResult).not.toHaveBeenCalled();
  });
});

function releaseIntent(): ProductJobIntent {
  return {
    command: ['bin/release'],
    deploymentId: 'dep-01jz',
    env: { DATABASE_URL: 'postgres://internal' },
    image: 'registry.example/release@sha256:abc',
    imagePullSecretId: 'pull-01jz',
    jobClass: 'release',
    namespace: 'cpt-prj-01jz',
    projectId: 'prj-01jz',
    timeoutMs: 30_000,
  };
}

function resourceOperationIntent(): ProductJobIntent {
  return {
    command: ['bin/backup'],
    env: {},
    image: 'postgres@sha256:abc',
    jobClass: 'resource-operation',
    namespace: 'cpt-prj-01jz',
    operationId: 'operation-1',
    projectId: 'prj-01jz',
    resourceIds: ['res-1'],
    timeoutMs: 30_000,
    volumeMounts: [
      {
        claimName: 'backup-artifacts',
        expectedClaimUid: 'uid-backup',
        mountPath: '/backups',
        name: 'backup',
        resourceId: 'res-1',
      },
    ],
  };
}

function successResult(): KubeJobResult {
  return {
    completedAt: new Date('2026-07-12T12:00:00.000Z'),
    exitCode: 0,
    finalize: vi.fn(async (): Promise<void> => await Promise.resolve()),
    jobName: 'cpt-job-dep-01jz',
    logs: 'complete output\n',
    podName: 'cpt-job-dep-01jz-pod',
    status: 'succeeded',
  };
}

function runtimeWithResult(result: KubeJobResult): KubeRuntime & { runJob: Mock } {
  return { runJob: vi.fn(async (): Promise<KubeJobResult> => await Promise.resolve(result)) } as never;
}

function runtimeWithSequence(results: (KubeJobResult | Error)[]): KubeRuntime & { runJob: Mock } {
  return {
    runJob: vi.fn(async (): Promise<KubeJobResult> => {
      const next: KubeJobResult | Error | undefined = results.shift();
      if (next === undefined) {
        throw new Error('Missing fake Job result.');
      }
      if (next instanceof Error) {
        throw next;
      }
      return await Promise.resolve(next);
    }),
  } as never;
}

function requester(): CompartmentRequester {
  return async function unexpectedRequest<TResult>(): Promise<TResult> {
    await Promise.resolve();
    throw new Error('Unexpected direct request.');
  };
}
