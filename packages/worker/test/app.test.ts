import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { WorkerConfig } from '../src/config';
import type { KubeControllerHost } from '../src/kube-controller-host';
import { runWorker } from '../src/app';
import type { WorkerArtifactRegistryConfig } from '../src/worker-artifact-registry.types';
import type { CompartmentRequester } from '@compartment/sdk';
import type { KubeRuntime } from '@compartment/kube-runtime';

type RunWorkerIteration = (config: WorkerConfig, runtime: KubeRuntime) => Promise<boolean>;
type RecoverOrphanedBuildClaims = (
  request: CompartmentRequester,
  input: { claimTimeoutMs: number },
) => Promise<{ requeuedDeploymentCount: number }>;
type WorkerTimeoutHandle = NodeJS.Timeout;
type WorkerTimerHandler = string | (() => void);

interface WorkerAppMocks {
  reconcileKube: Mock<() => Promise<boolean>>;
  runWorkerIteration: Mock<RunWorkerIteration>;
  runKubeControllerLoop: Mock<() => Promise<void>>;
  recoverOrphanedBuildClaims: Mock<RecoverOrphanedBuildClaims>;
  request: CompartmentRequester;
}

interface KubeControllerHostModuleMock {
  createKubeControllerHosts(): KubeControllerHost[];
}

const mocks: WorkerAppMocks = vi.hoisted(
  (): WorkerAppMocks => ({
    reconcileKube: vi.fn<() => Promise<boolean>>(),
    recoverOrphanedBuildClaims: vi.fn<RecoverOrphanedBuildClaims>(),
    request: vi.fn() as CompartmentRequester,
    runKubeControllerLoop: vi.fn<() => Promise<void>>(),
    runWorkerIteration: vi.fn<RunWorkerIteration>(),
  }),
);

vi.mock(
  '../src/kube-controller-host',
  (): KubeControllerHostModuleMock => ({
    createKubeControllerHosts: (): KubeControllerHost[] =>
      Array.from({ length: 3 }, (): KubeControllerHost => ({ reconcile: mocks.reconcileKube })),
  }),
);

vi.mock('../src/kube-controller-loop', (): { runKubeControllerLoop: Mock<() => Promise<void>> } => ({
  runKubeControllerLoop: mocks.runKubeControllerLoop,
}));

vi.mock('@compartment/kube-runtime', (): { createKubeRuntimeFromEnvironment: () => KubeRuntime } => ({
  createKubeRuntimeFromEnvironment: (): KubeRuntime => ({}) as KubeRuntime,
}));

vi.mock(
  '@compartment/sdk',
  (): {
    createCompartmentRequester: () => CompartmentRequester;
    isCompartmentRequestError: () => boolean;
    recoverOrphanedBuildClaims: Mock<RecoverOrphanedBuildClaims>;
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
    mocks.reconcileKube.mockResolvedValue(false);
    mocks.recoverOrphanedBuildClaims.mockResolvedValue({ requeuedDeploymentCount: 0 });
    mocks.runKubeControllerLoop.mockResolvedValue(undefined);
  });

  it('keeps polling the current worker path', async (): Promise<void> => {
    const stopLoopError: Error = new Error('stop worker loop');
    mocks.runWorkerIteration.mockResolvedValue(false);
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(createSetTimeoutImplementation(stopLoopError));

    await expect(runWorker(createWorkerConfig())).rejects.toBe(stopLoopError);

    expect(mocks.runWorkerIteration).toHaveBeenCalledTimes(2);
    expect(mocks.recoverOrphanedBuildClaims).toHaveBeenCalledTimes(1);
    expect(mocks.runWorkerIteration).toHaveBeenCalledWith(createWorkerConfig(), expect.any(Object), expect.any(Object));
    expect(mocks.runKubeControllerLoop).toHaveBeenCalledTimes(3);
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
    buildSandbox: {
      buildKitImage: 'moby/buildkit@sha256:builder',
      buildKitResources: {},
      gcKeepStorageMb: 2000,
      namespace: 'compartment-build',
      runnerImage: 'compartment-worker@sha256:runner',
      runnerResources: {},
      scheduling: { nodeSelector: {}, runtimeClassName: 'gvisor', tolerations: [] },
      timeoutMs: 900000,
    },
    buildQueue: { maximumConcurrentBuilds: 1, maximumConcurrentBuildsPerProject: 1 },
    customDomains: {
      caddyServiceName: 'compartment-caddy',
      ingressClassName: 'traefik',
      issuerRef: { kind: 'Issuer', name: 'compartment-platform' },
      namespace: 'compartment',
    },
    logLevel: 'silent',
    pollIntervalMs: 10,
    runtimeControlToken: 'worker-secret',
    tenantSecretsKek: { current: Buffer.alloc(32, 1) },
    usageMeteringIntervalMs: 60_000,
  };
}

function createArtifactRegistryConfig(): WorkerArtifactRegistryConfig {
  return {
    address: '127.0.0.1:5517',
    credentialSigningKey: 'registry-signing-key-with-at-least-32-characters',
    internalAddress: 'registry:5000',
    internalUrl: 'http://registry:5000',
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
