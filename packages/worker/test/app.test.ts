import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { WorkerRecoverDeploymentsQuery, WorkerRecoverDeploymentsResponse } from '@compartment/contracts';
import type { CompartmentRequester } from '@compartment/sdk';
import type { WorkerConfig } from '../src/config';
import type { WorkerArtifactRegistryConfig } from '../src/worker-artifact-registry.types';
import { runWorker } from '../src/app';
import type { KubeControllerHost } from '../src/kube-controller-host';

type CreateCompartmentRequester = (input: { apiUrl: string; internalToken: string }) => CompartmentRequester;
type CleanupWorkerArtifacts = (
  cleanupArtifacts: { imageRef: string }[],
  artifactRegistry: WorkerArtifactRegistryConfig,
  dockerNamespace: string,
) => Promise<void>;
type PrewarmSourceBuildToolchain = () => Promise<void>;
type RecoverRunningDeployments = (
  request: CompartmentRequester,
  query: WorkerRecoverDeploymentsQuery,
) => Promise<WorkerRecoverDeploymentsResponse>;
type RunWorkerIteration = (
  apiUrl: string,
  runtimeControlToken: string,
  dockerNamespace: string,
  artifactRegistry: WorkerArtifactRegistryConfig,
) => Promise<boolean>;
type WorkerTimeoutHandle = NodeJS.Timeout;
type WorkerTimerHandler = string | (() => void);

interface WorkerAppMocks {
  cleanupWorkerArtifacts: Mock<CleanupWorkerArtifacts>;
  createCompartmentRequester: Mock<CreateCompartmentRequester>;
  prewarmSourceBuildToolchain: Mock<PrewarmSourceBuildToolchain>;
  recoverRunningDeployments: Mock<RecoverRunningDeployments>;
  runWorkerIteration: Mock<RunWorkerIteration>;
  reconcileKube: Mock<() => Promise<boolean>>;
}

const mocks: WorkerAppMocks = vi.hoisted(
  (): WorkerAppMocks => ({
    cleanupWorkerArtifacts: vi.fn<CleanupWorkerArtifacts>(),
    createCompartmentRequester: vi.fn<CreateCompartmentRequester>(),
    prewarmSourceBuildToolchain: vi.fn<PrewarmSourceBuildToolchain>(),
    recoverRunningDeployments: vi.fn<RecoverRunningDeployments>(),
    runWorkerIteration: vi.fn<RunWorkerIteration>(),
    reconcileKube: vi.fn<() => Promise<boolean>>(),
  }),
);

vi.mock('../src/kube-controller-host', (): { createKubeControllerHost: () => KubeControllerHost } => ({
  createKubeControllerHost: (): KubeControllerHost => ({ enabled: false, reconcile: mocks.reconcileKube }),
}));

vi.mock('@compartment/docker', (): { prewarmSourceBuildToolchain: Mock<PrewarmSourceBuildToolchain> } => ({
  prewarmSourceBuildToolchain: mocks.prewarmSourceBuildToolchain,
}));

vi.mock(
  '@compartment/sdk',
  (): {
    createCompartmentRequester: Mock<CreateCompartmentRequester>;
    isCompartmentRequestError: (error: Error | null | undefined) => boolean;
    recoverRunningDeployments: Mock<RecoverRunningDeployments>;
  } => ({
    createCompartmentRequester: mocks.createCompartmentRequester,
    isCompartmentRequestError: (): boolean => false,
    recoverRunningDeployments: mocks.recoverRunningDeployments,
  }),
);

vi.mock('../src/services/worker.service', (): { runWorkerIteration: Mock<RunWorkerIteration> } => ({
  runWorkerIteration: mocks.runWorkerIteration,
}));

vi.mock(
  '../src/services/worker-artifact-cleanup.service',
  (): { cleanupWorkerArtifacts: Mock<CleanupWorkerArtifacts> } => ({
    cleanupWorkerArtifacts: mocks.cleanupWorkerArtifacts,
  }),
);

describe('runWorker', (): void => {
  afterEach((): void => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  beforeEach((): void => {
    mocks.reconcileKube.mockResolvedValue(false);
  });

  it('runs startup recovery once before switching steady-state recovery to pending drains', async (): Promise<void> => {
    const stopLoopError: Error = new Error('stop worker loop');
    const requester: CompartmentRequester = createUnexpectedRequester();

    mocks.createCompartmentRequester.mockReturnValue(requester);
    mocks.cleanupWorkerArtifacts.mockResolvedValue(undefined);
    mocks.prewarmSourceBuildToolchain.mockResolvedValueOnce();
    mocks.recoverRunningDeployments.mockResolvedValue({
      cleanupArtifacts: [],
      recoveredDeploymentCount: 0,
    });
    mocks.runWorkerIteration.mockResolvedValue(false);
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(createSetTimeoutImplementation(stopLoopError));

    await expect(runWorker(createWorkerConfig())).rejects.toBe(stopLoopError);

    expect(mocks.recoverRunningDeployments).toHaveBeenCalledTimes(2);
    expect(mocks.recoverRunningDeployments).toHaveBeenNthCalledWith(1, requester, {
      mode: 'all',
    });
    expect(mocks.recoverRunningDeployments).toHaveBeenNthCalledWith(2, requester, {
      mode: 'pending-drain',
    });
    expect(mocks.prewarmSourceBuildToolchain).toHaveBeenCalledTimes(1);
    expect(mocks.runWorkerIteration).toHaveBeenCalledTimes(2);
  });

  it('keeps polling when source build toolchain prewarm fails', async (): Promise<void> => {
    const stopLoopError: Error = new Error('stop worker loop');
    const requester: CompartmentRequester = createUnexpectedRequester();

    mocks.createCompartmentRequester.mockReturnValue(requester);
    mocks.cleanupWorkerArtifacts.mockResolvedValue(undefined);
    mocks.prewarmSourceBuildToolchain.mockRejectedValueOnce(new Error('registry unavailable'));
    mocks.recoverRunningDeployments.mockResolvedValue({
      cleanupArtifacts: [],
      recoveredDeploymentCount: 0,
    });
    mocks.runWorkerIteration.mockResolvedValue(false);
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(createSetTimeoutImplementation(stopLoopError));

    await expect(runWorker(createWorkerConfig())).rejects.toBe(stopLoopError);

    await Promise.resolve();

    expect(mocks.prewarmSourceBuildToolchain).toHaveBeenCalledTimes(1);
    expect(mocks.runWorkerIteration).toHaveBeenCalledTimes(2);
  });

  it('keeps polling when pending drain recovery fails', async (): Promise<void> => {
    const stopLoopError: Error = new Error('stop worker loop');
    const requester: CompartmentRequester = createUnexpectedRequester();

    mocks.createCompartmentRequester.mockReturnValue(requester);
    mocks.cleanupWorkerArtifacts.mockResolvedValue(undefined);
    mocks.prewarmSourceBuildToolchain.mockResolvedValueOnce();
    mocks.recoverRunningDeployments
      .mockResolvedValueOnce({
        cleanupArtifacts: [],
        recoveredDeploymentCount: 0,
      })
      .mockRejectedValueOnce(new Error('drain cleanup failed'));
    mocks.runWorkerIteration.mockResolvedValue(false);
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(createSetTimeoutImplementation(stopLoopError));

    await expect(runWorker(createWorkerConfig())).rejects.toBe(stopLoopError);

    expect(mocks.recoverRunningDeployments).toHaveBeenCalledTimes(2);
    expect(mocks.recoverRunningDeployments).toHaveBeenNthCalledWith(1, requester, {
      mode: 'all',
    });
    expect(mocks.recoverRunningDeployments).toHaveBeenNthCalledWith(2, requester, {
      mode: 'pending-drain',
    });
    expect(mocks.runWorkerIteration).toHaveBeenCalledTimes(2);
  });

  it('runs retained artifact cleanup for recovered deployments', async (): Promise<void> => {
    const stopLoopError: Error = new Error('stop worker loop');
    const requester: CompartmentRequester = createUnexpectedRequester();

    mocks.createCompartmentRequester.mockReturnValue(requester);
    mocks.cleanupWorkerArtifacts.mockResolvedValue(undefined);
    mocks.prewarmSourceBuildToolchain.mockResolvedValueOnce();
    mocks.recoverRunningDeployments.mockResolvedValue({
      cleanupArtifacts: [
        {
          imageRef: '127.0.0.1:5517/compartment/projects/prj_123/services/svc_123@sha256:abc',
        },
      ],
      recoveredDeploymentCount: 1,
    });
    mocks.runWorkerIteration.mockResolvedValue(false);
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(createSetTimeoutImplementation(stopLoopError));

    await expect(runWorker(createWorkerConfig())).rejects.toBe(stopLoopError);

    expect(mocks.cleanupWorkerArtifacts).toHaveBeenNthCalledWith(
      1,
      [
        {
          imageRef: '127.0.0.1:5517/compartment/projects/prj_123/services/svc_123@sha256:abc',
        },
      ],
      {
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
      },
      'compartment-e2e',
    );
  });
});

function createWorkerConfig(): WorkerConfig {
  return {
    apiUrl: 'http://127.0.0.1:9443',
    artifactRegistry: {
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
    },
    buildKitAddress: 'tcp://builder:1234',
    dockerNamespace: 'compartment-e2e',
    logLevel: 'silent',
    pollIntervalMs: 10,
    runtimeControlToken: 'worker-secret',
  };
}

function createUnexpectedRequester(): CompartmentRequester {
  return async function unexpectedRequester<TResult>(): Promise<TResult> {
    await Promise.resolve();
    throw new Error('Unexpected compartment request during worker app test.');
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
