import type { WorkerRecoverOrphanedBuildClaimsResponse } from '@compartment/contracts';
import {
  createKubeLeaderElectionFromEnvironment,
  createKubeRuntimeFromEnvironment,
  type KubeLeaderElector,
  type KubeRuntime,
} from '@compartment/kube-runtime';
import { createCompartmentRequester, isCompartmentRequestError, recoverOrphanedBuildClaims } from '@compartment/sdk';
import { waitForAbortOrTimeout } from '@compartment/utils';
import pino from 'pino';
import { readWorkerConfig, workerLeaderElectionConfig, type WorkerConfig } from './config';
import { createKubeControllerHosts, type KubeControllerHost } from './kube-controller-host';
import { runKubeControllerLoop } from './kube-controller-loop';
import { buildWorkerCaughtErrorLogPayload } from './logging/worker-error-log';
import type { WorkerCaughtError } from './logging/worker-error-log.types';
import { runWorkerIteration } from './services/worker.service';

interface WorkerState {
  hasReachedApi: boolean;
  hasRecoveredLeadership: boolean;
  nextBuildClaimRecoveryAt: number;
  recoveryPromise?: Promise<WorkerRecoverOrphanedBuildClaimsResponse> | undefined;
}

interface WorkerFetchError extends Error {
  cause?: {
    code?: string | undefined;
  };
}

const buildClaimRecoveryGraceMs: number = 60_000;
const buildClaimRecoveryIntervalMs: number = 60_000;

export async function runWorker(config: WorkerConfig = readWorkerConfig()): Promise<void> {
  const logger: pino.Logger<never, boolean> = createWorkerLogger(config);
  const runtime: KubeRuntime = createKubeRuntimeFromEnvironment();
  const election: KubeLeaderElector = createKubeLeaderElectionFromEnvironment(
    workerLeaderElectionConfig(config, 'compartment-worker', config.customDomains.namespace),
    {
      onError: (error: Error): void => logger.warn({ err: error }, 'Worker leader election retrying.'),
      onLeader: (): void => logger.info('Worker acquired leadership.'),
      onStandby: (): void => logger.info('Worker is standing by.'),
    },
  );
  const shutdown: AbortController = createShutdownController();
  await election.run(
    async (signal: AbortSignal): Promise<void> => await runActiveWorker(config, runtime, logger, signal),
    shutdown.signal,
  );
}

async function runActiveWorker(
  config: WorkerConfig,
  runtime: KubeRuntime,
  logger: pino.Logger<never, boolean>,
  signal: AbortSignal,
): Promise<void> {
  const state: WorkerState = { hasReachedApi: false, hasRecoveredLeadership: false, nextBuildClaimRecoveryAt: 0 };
  const kubeControllers: KubeControllerHost[] = createKubeControllerHosts(config, logger, runtime);

  const controllerLoops: Promise<void>[] = kubeControllers.map(
    async (kubeController: KubeControllerHost): Promise<void> =>
      await runKubeControllerLoop(config, logger, kubeController, signal),
  );
  const workerLoops: Promise<void>[] = Array.from(
    { length: config.buildQueue.maximumConcurrentBuilds },
    async (): Promise<void> => await runWorkerLoop(config, runtime, logger, state, signal),
  );
  await Promise.all([...controllerLoops, ...workerLoops]);
}

function createWorkerLogger(config: WorkerConfig): pino.Logger<never, boolean> {
  return pino({
    base: {
      service: 'worker',
    },
    level: config.logLevel,
  });
}

async function runWorkerLoop(
  config: WorkerConfig,
  runtime: KubeRuntime,
  logger: pino.Logger<never, boolean>,
  state: WorkerState,
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    await runWorkerCycle(config, runtime, logger, state, signal);
  }
}

async function runWorkerCycle(
  config: WorkerConfig,
  runtime: KubeRuntime,
  logger: pino.Logger<never, boolean>,
  state: WorkerState,
  signal: AbortSignal,
): Promise<void> {
  try {
    if (await recoverWorkerBuildClaimsIfNeeded(config, logger, state)) {
      return;
    }
    const claimedWork: boolean = await runWorkerIteration(config, runtime, logger);
    state.hasReachedApi = true;
    if (!claimedWork) {
      await waitForAbortOrTimeout(config.pollIntervalMs, signal);
    }
  } catch (error) {
    await handleWorkerIterationError(config, logger, state, error as WorkerCaughtError, signal);
  }
}

async function recoverWorkerBuildClaimsIfNeeded(
  config: WorkerConfig,
  logger: pino.Logger<never, boolean>,
  state: WorkerState,
): Promise<boolean> {
  if (Date.now() < state.nextBuildClaimRecoveryAt) {
    return false;
  }
  const recovery: WorkerRecoverOrphanedBuildClaimsResponse = await recoverWorkerBuildClaims(config, state);
  state.hasReachedApi = true;
  state.hasRecoveredLeadership = true;
  state.nextBuildClaimRecoveryAt = Date.now() + buildClaimRecoveryIntervalMs;
  state.recoveryPromise = undefined;
  if (recovery.requeuedDeploymentCount > 0) {
    logger.warn(recovery, 'Requeued orphaned deployment build claims before polling.');
  }
  return recovery.requeuedDeploymentCount > 0;
}

async function recoverWorkerBuildClaims(
  config: WorkerConfig,
  state: WorkerState,
): Promise<WorkerRecoverOrphanedBuildClaimsResponse> {
  state.recoveryPromise ??= recoverOrphanedBuildClaims(
    createCompartmentRequester({ apiUrl: config.apiUrl, internalToken: config.runtimeControlToken }),
    {
      claimTimeoutMs: state.hasRecoveredLeadership ? config.buildSandbox.timeoutMs + buildClaimRecoveryGraceMs : 1,
    },
  );
  try {
    return await state.recoveryPromise;
  } catch (error) {
    state.recoveryPromise = undefined;
    throw error;
  }
}

async function handleWorkerIterationError(
  config: WorkerConfig,
  logger: pino.Logger<never, boolean>,
  state: WorkerState,
  error: WorkerCaughtError,
  signal: AbortSignal,
): Promise<void> {
  state.hasReachedApi = state.hasReachedApi || (error instanceof Error && isCompartmentRequestError(error));
  if (shouldWarnOnWorkerStartupRetry(error, state.hasReachedApi)) {
    logger.warn(buildWorkerCaughtErrorLogPayload(error), 'Worker startup dependency is not ready yet. Retrying.');
  } else {
    logger.error(buildWorkerCaughtErrorLogPayload(error), 'Worker iteration failed.');
  }
  await waitForAbortOrTimeout(config.pollIntervalMs, signal);
}

function shouldWarnOnWorkerStartupRetry(error: WorkerCaughtError, hasReachedApi: boolean): boolean {
  if (error instanceof Error && isCompartmentRequestError(error) && error.code === 'not_installed') {
    return true;
  }

  return !hasReachedApi && error instanceof Error && readWorkerErrorCauseCode(error) === 'ECONNREFUSED';
}

function readWorkerErrorCauseCode(error: Error): string | null {
  const fetchError: WorkerFetchError = error as WorkerFetchError;
  return typeof fetchError.cause?.code === 'string' ? fetchError.cause.code : null;
}

function createShutdownController(): AbortController {
  const controller: AbortController = new AbortController();
  const stop: () => void = (): void => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return controller;
}
