import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { WorkerConfig } from '../src/config';
import type { KubeControllerHost } from '../src/kube-controller-host';
import { runWorker } from '../src/app';
import type { WorkerArtifactRegistryConfig } from '../src/worker-artifact-registry.types';
import type { CompartmentRequester } from '@compartment/sdk';

type PrewarmSourceBuildToolchain = () => Promise<void>;
type RunWorkerIteration = (
  apiUrl: string,
  runtimeControlToken: string,
  artifactRegistry: WorkerArtifactRegistryConfig,
) => Promise<boolean>;
type WorkerTimeoutHandle = NodeJS.Timeout;
type WorkerTimerHandler = string | (() => void);

interface WorkerAppMocks {
  prewarmSourceBuildToolchain: Mock<PrewarmSourceBuildToolchain>;
  reconcileKube: Mock<() => Promise<boolean>>;
  runWorkerIteration: Mock<RunWorkerIteration>;
  runKubeControllerLoop: Mock<() => Promise<void>>;
  recoverOrphanedBuildClaims: Mock<() => Promise<{ requeuedDeploymentCount: number }>>;
  request: CompartmentRequester;
}

const mocks: WorkerAppMocks = vi.hoisted(
  (): WorkerAppMocks => ({
    prewarmSourceBuildToolchain: vi.fn<PrewarmSourceBuildToolchain>(),
    reconcileKube: vi.fn<() => Promise<boolean>>(),
    recoverOrphanedBuildClaims: vi.fn<() => Promise<{ requeuedDeploymentCount: number }>>(),
    request: vi.fn() as CompartmentRequester,
    runKubeControllerLoop: vi.fn<() => Promise<void>>(),
    runWorkerIteration: vi.fn<RunWorkerIteration>(),
  }),
);

vi.mock('../src/kube-controller-host', (): { createKubeControllerHost: () => KubeControllerHost } => ({
  createKubeControllerHost: (): KubeControllerHost => ({ reconcile: mocks.reconcileKube }),
}));

vi.mock('../src/kube-controller-loop', (): { runKubeControllerLoop: Mock<() => Promise<void>> } => ({
  runKubeControllerLoop: mocks.runKubeControllerLoop,
}));

vi.mock('@compartment/docker', (): { prewarmSourceBuildToolchain: Mock<PrewarmSourceBuildToolchain> } => ({
  prewarmSourceBuildToolchain: mocks.prewarmSourceBuildToolchain,
}));

vi.mock(
  '@compartment/sdk',
  (): {
    createCompartmentRequester: () => CompartmentRequester;
    isCompartmentRequestError: () => boolean;
    recoverOrphanedBuildClaims: Mock<() => Promise<{ requeuedDeploymentCount: number }>>;
  } => ({
    createCompartmentRequester: (): CompartmentRequester => mocks.request,
    isCompartmentRequestError: (): boolean => false,
    recoverOrphanedBuildClaims: mocks.recoverOrphanedBuildClaims,
  }),
);

vi.mock('../src/services/worker.service', (): { runWorkerIteration: Mock<RunWorkerIteration> } => ({
  runWorkerIteration: mocks.runWorkerIteration,
}));

describe('runWorker', (): void => {
  afterEach((): void => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  beforeEach((): void => {
    mocks.prewarmSourceBuildToolchain.mockResolvedValue(undefined);
    mocks.reconcileKube.mockResolvedValue(false);
    mocks.recoverOrphanedBuildClaims.mockResolvedValue({ requeuedDeploymentCount: 0 });
    mocks.runKubeControllerLoop.mockResolvedValue(undefined);
  });

  it('keeps polling the current worker path and prewarms BuildKit once', async (): Promise<void> => {
    const stopLoopError: Error = new Error('stop worker loop');
    mocks.runWorkerIteration.mockResolvedValue(false);
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(createSetTimeoutImplementation(stopLoopError));

    await expect(runWorker(createWorkerConfig())).rejects.toBe(stopLoopError);

    expect(mocks.prewarmSourceBuildToolchain).toHaveBeenCalledTimes(1);
    expect(mocks.runWorkerIteration).toHaveBeenCalledTimes(2);
    expect(mocks.recoverOrphanedBuildClaims).toHaveBeenCalledTimes(1);
    expect(mocks.runWorkerIteration).toHaveBeenCalledWith(
      'http://127.0.0.1:9443',
      'worker-secret',
      createArtifactRegistryConfig(),
    );
  });

  it('keeps polling when source build toolchain prewarm fails', async (): Promise<void> => {
    const stopLoopError: Error = new Error('stop worker loop');
    mocks.prewarmSourceBuildToolchain.mockRejectedValueOnce(new Error('registry unavailable'));
    mocks.runWorkerIteration.mockResolvedValue(false);
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(createSetTimeoutImplementation(stopLoopError));

    await expect(runWorker(createWorkerConfig())).rejects.toBe(stopLoopError);

    await Promise.resolve();
    expect(mocks.prewarmSourceBuildToolchain).toHaveBeenCalledTimes(1);
    expect(mocks.runWorkerIteration).toHaveBeenCalledTimes(2);
  });

  it('retries after a transient worker iteration failure', async (): Promise<void> => {
    const stopLoopError: Error = new Error('stop worker loop');
    mocks.runWorkerIteration.mockRejectedValueOnce(new Error('api unavailable')).mockResolvedValue(false);
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(createSetTimeoutImplementation(stopLoopError));

    await expect(runWorker(createWorkerConfig())).rejects.toBe(stopLoopError);

    expect(mocks.runWorkerIteration).toHaveBeenCalledTimes(2);
  });
});

function createWorkerConfig(): WorkerConfig {
  return {
    apiUrl: 'http://127.0.0.1:9443',
    artifactRegistry: createArtifactRegistryConfig(),
    buildKitAddress: 'tcp://builder:1234',
    logLevel: 'silent',
    pollIntervalMs: 10,
    runtimeControlToken: 'worker-secret',
  };
}

function createArtifactRegistryConfig(): WorkerArtifactRegistryConfig {
  return {
    address: '127.0.0.1:5517',
    internalUrl: 'http://registry:5000',
    mode: 'bundled',
    readCredentials: {
      password: 'read-password',
      username: 'reader',
    },
    writeCredentials: {
      password: 'write-password',
      username: 'writer',
    },
  };
}

function createSetTimeoutImplementation(stopLoopError: Error): typeof setTimeout {
  let timeoutCallCount: number = 0;

  return ((callback: WorkerTimerHandler): WorkerTimeoutHandle => {
    timeoutCallCount += 1;
    if (timeoutCallCount >= 2) {
      throw stopLoopError;
    }
    if (typeof callback === 'function') {
      callback();
    }

    return {} as WorkerTimeoutHandle;
  }) as typeof setTimeout;
}
