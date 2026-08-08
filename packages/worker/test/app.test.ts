import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CompartmentRequester } from '@compartment/sdk';
import type { KubeLeaderElector, KubeRuntime } from '@compartment/kube-runtime';
import type { WorkerConfig } from '../src/config';
import type { KubeControllerHost } from '../src/kube-controller-host';
import type { WorkerBuildTask } from '../src/services/worker-iteration.types';
import { runWorker } from '../src/app';
import { createWorkerAppTestConfig, DeferredValue } from './worker-app-test.fixtures';

type RunAuxiliaryWorkerIteration = (config: WorkerConfig) => Promise<boolean>;
type StartNextBuild = (config: WorkerConfig, runtime: KubeRuntime) => Promise<WorkerBuildTask | null>;
type RecoverOrphanedBuildClaims = (
  request: CompartmentRequester,
  input: { claimTimeoutMs: number },
) => Promise<{ requeuedDeploymentCount: number }>;

interface WorkerAppMocks {
  controller: AbortController;
  recoverOrphanedBuildClaims: Mock<RecoverOrphanedBuildClaims>;
  request: CompartmentRequester;
  runAuxiliaryWorkerIteration: Mock<RunAuxiliaryWorkerIteration>;
  runKubeControllerLoop: Mock<() => Promise<void>>;
  startNextBuild: Mock<StartNextBuild>;
}

interface KubeControllerHostModuleMock {
  createKubeControllerHosts(): KubeControllerHost[];
}

const mocks: WorkerAppMocks = vi.hoisted(
  (): WorkerAppMocks => ({
    controller: new AbortController(),
    recoverOrphanedBuildClaims: vi.fn<RecoverOrphanedBuildClaims>(),
    request: vi.fn() as CompartmentRequester,
    runAuxiliaryWorkerIteration: vi.fn<RunAuxiliaryWorkerIteration>(),
    runKubeControllerLoop: vi.fn<() => Promise<void>>(),
    startNextBuild: vi.fn<StartNextBuild>(),
  }),
);

vi.mock(
  '../src/kube-controller-host',
  (): KubeControllerHostModuleMock => ({
    createKubeControllerHosts: (): KubeControllerHost[] =>
      Array.from({ length: 3 }, (): KubeControllerHost => ({ reconcile: vi.fn() })),
  }),
);

vi.mock('../src/kube-controller-loop', (): { runKubeControllerLoop: Mock<() => Promise<void>> } => ({
  runKubeControllerLoop: mocks.runKubeControllerLoop,
}));

vi.mock(
  '@compartment/kube-runtime',
  (): {
    createKubeLeaderElectionFromEnvironment: () => KubeLeaderElector;
    createKubeRuntimeFromEnvironment: () => KubeRuntime;
  } => ({
    createKubeLeaderElectionFromEnvironment: (): KubeLeaderElector => ({
      run: async (work: (signal: AbortSignal) => Promise<void>): Promise<void> => await work(mocks.controller.signal),
    }),
    createKubeRuntimeFromEnvironment: (): KubeRuntime => ({}) as KubeRuntime,
  }),
);

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

vi.mock(
  '../src/services/worker.service',
  (): {
    runAuxiliaryWorkerIteration: Mock<RunAuxiliaryWorkerIteration>;
    startNextBuild: Mock<StartNextBuild>;
  } => ({
    runAuxiliaryWorkerIteration: mocks.runAuxiliaryWorkerIteration,
    startNextBuild: mocks.startNextBuild,
  }),
);

describe('runWorker', (): void => {
  afterEach((): void => {
    vi.useRealTimers();
  });

  beforeEach((): void => {
    vi.clearAllMocks();
    mocks.controller = new AbortController();
    mocks.recoverOrphanedBuildClaims.mockResolvedValue({ requeuedDeploymentCount: 0 });
    mocks.runAuxiliaryWorkerIteration.mockResolvedValue(false);
    mocks.runKubeControllerLoop.mockResolvedValue(undefined);
    mocks.startNextBuild.mockResolvedValue(null);
  });

  it('keeps auxiliary concurrency bounded when maximum build concurrency is high', async (): Promise<void> => {
    const config: WorkerConfig = createWorkerAppTestConfig(100);
    const auxiliaryCompletions: DeferredValue<boolean>[] = createAuxiliaryCompletions();
    mocks.runAuxiliaryWorkerIteration
      .mockReturnValueOnce(auxiliaryCompletions[0]?.promise ?? Promise.resolve(false))
      .mockReturnValueOnce(auxiliaryCompletions[1]?.promise ?? Promise.resolve(false));
    mocks.startNextBuild.mockImplementationOnce(async (): Promise<null> => {
      mocks.controller.abort();
      return await Promise.resolve(null);
    });

    const workerPromise: Promise<void> = runWorker(config);
    await vi.waitFor((): void => expect(mocks.runAuxiliaryWorkerIteration).toHaveBeenCalledTimes(2));
    auxiliaryCompletions.forEach((completion: DeferredValue<boolean>): void => completion.resolve(false));
    await expect(workerPromise).resolves.toBeUndefined();

    expect(mocks.runAuxiliaryWorkerIteration).toHaveBeenCalledTimes(2);
    expect(mocks.startNextBuild).toHaveBeenCalledTimes(1);
  });

  it('fills the configured build capacity without multiplying auxiliary polling', async (): Promise<void> => {
    const config: WorkerConfig = createWorkerAppTestConfig(3);
    const completions: DeferredValue<void>[] = Array.from(
      { length: 3 },
      (): DeferredValue<void> => new DeferredValue<void>(),
    );
    const auxiliaryCompletions: DeferredValue<boolean>[] = createAuxiliaryCompletions();
    const fourthClaim: DeferredValue<WorkerBuildTask | null> = new DeferredValue<WorkerBuildTask | null>();
    mocks.runAuxiliaryWorkerIteration
      .mockReturnValueOnce(auxiliaryCompletions[0]?.promise ?? Promise.resolve(false))
      .mockReturnValueOnce(auxiliaryCompletions[1]?.promise ?? Promise.resolve(false));
    for (const completion of completions) {
      mocks.startNextBuild.mockResolvedValueOnce({ completion: completion.promise });
    }
    mocks.startNextBuild.mockReturnValueOnce(fourthClaim.promise);

    const workerPromise: Promise<void> = runWorker(config);
    await vi.waitFor((): void => expect(mocks.startNextBuild).toHaveBeenCalledTimes(3));

    expect(mocks.runAuxiliaryWorkerIteration).toHaveBeenCalledTimes(2);
    completions[0]?.resolve(undefined);
    await vi.waitFor((): void => expect(mocks.startNextBuild).toHaveBeenCalledTimes(4));

    mocks.controller.abort();
    fourthClaim.resolve(null);
    auxiliaryCompletions.forEach((completion: DeferredValue<boolean>): void => completion.resolve(false));
    completions.slice(1).forEach((completion: DeferredValue<void>): void => completion.resolve(undefined));
    await expect(workerPromise).resolves.toBeUndefined();

    expect(mocks.runAuxiliaryWorkerIteration).toHaveBeenCalledTimes(2);
  });

  it('polls an empty build queue only after the configured interval', async (): Promise<void> => {
    vi.useFakeTimers();
    const auxiliaryCompletions: DeferredValue<boolean>[] = createAuxiliaryCompletions();
    mocks.runAuxiliaryWorkerIteration
      .mockReturnValueOnce(auxiliaryCompletions[0]?.promise ?? Promise.resolve(false))
      .mockReturnValueOnce(auxiliaryCompletions[1]?.promise ?? Promise.resolve(false));
    mocks.startNextBuild.mockResolvedValueOnce(null).mockImplementationOnce(async (): Promise<null> => {
      mocks.controller.abort();
      return await Promise.resolve(null);
    });

    const workerPromise: Promise<void> = runWorker(createWorkerAppTestConfig(100));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.startNextBuild).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(9);
    expect(mocks.startNextBuild).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    auxiliaryCompletions.forEach((completion: DeferredValue<boolean>): void => completion.resolve(false));
    await expect(workerPromise).resolves.toBeUndefined();
    expect(mocks.startNextBuild).toHaveBeenCalledTimes(2);
  });

  it('releases build capacity after a completion rejects', async (): Promise<void> => {
    const failedCompletion: DeferredValue<void> = new DeferredValue<void>();
    mocks.startNextBuild
      .mockResolvedValueOnce({ completion: failedCompletion.promise })
      .mockImplementationOnce(async (): Promise<null> => {
        mocks.controller.abort();
        return await Promise.resolve(null);
      });

    const workerPromise: Promise<void> = runWorker(createWorkerAppTestConfig(1));
    await vi.waitFor((): void => expect(mocks.startNextBuild).toHaveBeenCalledTimes(1));
    failedCompletion.reject(new Error('completion failed'));
    await expect(workerPromise).resolves.toBeUndefined();
    expect(mocks.startNextBuild).toHaveBeenCalledTimes(2);
  });

  it('drains active builds before shutdown completes', async (): Promise<void> => {
    const completion: DeferredValue<void> = new DeferredValue<void>();
    mocks.startNextBuild.mockResolvedValueOnce({ completion: completion.promise });
    const workerPromise: Promise<void> = runWorker(createWorkerAppTestConfig(1));
    let workerSettled: boolean = false;
    void workerPromise.finally((): void => {
      workerSettled = true;
    });
    await vi.waitFor((): void => expect(mocks.startNextBuild).toHaveBeenCalledTimes(1));

    mocks.controller.abort();
    await Promise.resolve();
    expect(workerSettled).toBe(false);
    expect(mocks.startNextBuild).toHaveBeenCalledTimes(1);
    completion.resolve(undefined);
    await expect(workerPromise).resolves.toBeUndefined();
    expect(workerSettled).toBe(true);
  });
});

function createAuxiliaryCompletions(): DeferredValue<boolean>[] {
  return [new DeferredValue<boolean>(), new DeferredValue<boolean>()];
}
