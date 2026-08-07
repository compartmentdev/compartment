import type { WorkerRecoverOrphanedBuildClaimsResponse } from '@compartment/contracts';
import {
  createKubeLeaderElectionFromEnvironment,
  createKubeRuntimeFromEnvironment,
  type KubeLeaderElector,
  type KubeRuntime,
} from '@compartment/kube-runtime';
import { createCompartmentRequester, isCompartmentRequestError, recoverOrphanedBuildClaims } from '@compartment/sdk';
import { waitForAbortOrTimeout } from '@compartment/utils';
import type pino from 'pino';
import { readWorkerConfig, workerLeaderElectionConfig, type WorkerConfig } from './config';
import { createKubeControllerHosts, type KubeControllerHost } from './kube-controller-host';
import { runKubeControllerLoop } from './kube-controller-loop';
import { buildWorkerCaughtErrorLogPayload } from './logging/worker-error-log';
import type { WorkerCaughtError, WorkerFetchError } from './logging/worker-error-log.types';
import { createWorkerLogger } from './logging/worker-logger';
import type { WorkerBuildTask } from './services/worker-iteration.types';
import { runAuxiliaryWorkerIteration, startNextBuild } from './services/worker.service';

interface WorkerState {
  hasReachedApi: boolean;
  hasRecoveredLeadership: boolean;
  nextBuildClaimRecoveryAt: number;
  recoveryPromise?: Promise<WorkerRecoverOrphanedBuildClaimsResponse> | undefined;
}

const buildClaimRecoveryGraceMs: number = 60_000;
const buildClaimRecoveryIntervalMs: number = 60_000;
const auxiliaryWorkerConcurrency: number = 2;

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
  await Promise.all([...controllerLoops, runWorkerPolling(config, runtime, logger, state, signal)]);
}

async function runWorkerPolling(
  config: WorkerConfig,
  runtime: KubeRuntime,
  logger: pino.Logger<never, boolean>,
  state: WorkerState,
  signal: AbortSignal,
): Promise<void> {
  await recoverWorkerBuildClaimsBeforePolling(config, logger, state, signal);
  const auxiliaryWorkerLoops: Promise<void>[] = Array.from(
    { length: auxiliaryWorkerConcurrency },
    async (): Promise<void> => await runAuxiliaryWorkerLoop(config, logger, state, signal),
  );
  await Promise.all([...auxiliaryWorkerLoops, runBuildDispatcher(config, runtime, logger, state, signal)]);
}

async function runAuxiliaryWorkerLoop(
  config: WorkerConfig,
  logger: pino.Logger<never, boolean>,
  state: WorkerState,
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    await runAuxiliaryWorkerCycle(config, logger, state, signal);
  }
}

async function runAuxiliaryWorkerCycle(
  config: WorkerConfig,
  logger: pino.Logger<never, boolean>,
  state: WorkerState,
  signal: AbortSignal,
): Promise<void> {
  try {
    if (await recoverWorkerBuildClaimsIfNeeded(config, logger, state)) {
      return;
    }
    const claimedWork: boolean = await runAuxiliaryWorkerIteration(config, logger);
    state.hasReachedApi = true;
    if (!claimedWork) {
      await waitForAbortOrTimeout(config.pollIntervalMs, signal);
    }
  } catch (error) {
    await handleWorkerIterationError(config, logger, state, error as WorkerCaughtError, signal);
  }
}

async function runBuildDispatcher(
  config: WorkerConfig,
  runtime: KubeRuntime,
  logger: pino.Logger<never, boolean>,
  state: WorkerState,
  signal: AbortSignal,
): Promise<void> {
  const activeBuilds: Set<Promise<void>> = new Set<Promise<void>>();
  while (!signal.aborted) {
    await runBuildDispatcherCycle(config, runtime, logger, state, signal, activeBuilds);
  }
  await Promise.all(activeBuilds);
}

async function runBuildDispatcherCycle(
  config: WorkerConfig,
  runtime: KubeRuntime,
  logger: pino.Logger<never, boolean>,
  state: WorkerState,
  signal: AbortSignal,
  activeBuilds: Set<Promise<void>>,
): Promise<void> {
  if (activeBuilds.size >= config.buildQueue.maximumConcurrentBuilds) {
    await Promise.race(activeBuilds);
    return;
  }
  try {
    const task: WorkerBuildTask | null = await startNextBuild(config, runtime, logger);
    state.hasReachedApi = true;
    if (task === null) {
      await waitForBuildCapacityOrPollInterval(activeBuilds, config.pollIntervalMs, signal);
      return;
    }
    trackBuildCompletion(activeBuilds, task, logger, state);
  } catch (error) {
    await handleWorkerIterationError(config, logger, state, error as WorkerCaughtError, signal);
  }
}

function trackBuildCompletion(
  activeBuilds: Set<Promise<void>>,
  task: WorkerBuildTask,
  logger: pino.Logger<never, boolean>,
  state: WorkerState,
): void {
  const trackedCompletion: Promise<void> = task.completion
    .catch((error: WorkerCaughtError): void => recordWorkerIterationError(logger, state, error))
    .finally((): void => {
      activeBuilds.delete(trackedCompletion);
    });
  activeBuilds.add(trackedCompletion);
}

async function waitForBuildCapacityOrPollInterval(
  activeBuilds: Set<Promise<void>>,
  pollIntervalMs: number,
  signal: AbortSignal,
): Promise<void> {
  const pollInterval: Promise<void> = waitForAbortOrTimeout(pollIntervalMs, signal);
  await (activeBuilds.size === 0 ? pollInterval : Promise.race([Promise.race(activeBuilds), pollInterval]));
}

async function recoverWorkerBuildClaimsBeforePolling(
  config: WorkerConfig,
  logger: pino.Logger<never, boolean>,
  state: WorkerState,
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted && !state.hasRecoveredLeadership) {
    try {
      await recoverWorkerBuildClaimsIfNeeded(config, logger, state);
    } catch (error) {
      await handleWorkerIterationError(config, logger, state, error as WorkerCaughtError, signal);
    }
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
  recordWorkerIterationError(logger, state, error);
  await waitForAbortOrTimeout(config.pollIntervalMs, signal);
}

function recordWorkerIterationError(
  logger: pino.Logger<never, boolean>,
  state: WorkerState,
  error: WorkerCaughtError,
): void {
  state.hasReachedApi = state.hasReachedApi || (error instanceof Error && isCompartmentRequestError(error));
  if (shouldWarnOnWorkerStartupRetry(error, state.hasReachedApi)) {
    logger.warn(buildWorkerCaughtErrorLogPayload(error), 'Worker startup dependency is not ready yet. Retrying.');
  } else {
    logger.error(buildWorkerCaughtErrorLogPayload(error), 'Worker iteration failed.');
  }
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
