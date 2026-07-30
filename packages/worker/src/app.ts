import type { WorkerRecoverOrphanedBuildClaimsResponse } from '@compartment/contracts';
import { createKubeRuntimeFromEnvironment, type KubeRuntime } from '@compartment/kube-runtime';
import { createCompartmentRequester, isCompartmentRequestError, recoverOrphanedBuildClaims } from '@compartment/sdk';
import pino from 'pino';
import { readWorkerConfig, type WorkerConfig } from './config';
import { createKubeControllerHosts, type KubeControllerHost } from './kube-controller-host';
import { runKubeControllerLoop } from './kube-controller-loop';
import { buildWorkerCaughtErrorLogPayload } from './logging/worker-error-log';
import type { WorkerCaughtError } from './logging/worker-error-log.types';
import { runWorkerIteration } from './services/worker.service';

interface WorkerState {
  hasReachedApi: boolean;
  recoveredOrphanedBuildClaims: boolean;
}

interface WorkerFetchError extends Error {
  cause?: {
    code?: string | undefined;
  };
}

export async function runWorker(config: WorkerConfig = readWorkerConfig()): Promise<void> {
  const logger: pino.Logger<never, boolean> = createWorkerLogger(config);
  const state: WorkerState = { hasReachedApi: false, recoveredOrphanedBuildClaims: false };
  const runtime: KubeRuntime = createKubeRuntimeFromEnvironment();
  const kubeControllers: KubeControllerHost[] = createKubeControllerHosts(config, logger, runtime);

  for (const kubeController of kubeControllers) {
    void runKubeControllerLoop(config, logger, kubeController);
  }
  await runWorkerLoop(config, runtime, logger, state);
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
): Promise<void> {
  for (;;) {
    await runWorkerCycle(config, runtime, logger, state);
  }
}

async function runWorkerCycle(
  config: WorkerConfig,
  runtime: KubeRuntime,
  logger: pino.Logger<never, boolean>,
  state: WorkerState,
): Promise<void> {
  try {
    if (await recoverWorkerBuildClaimsIfNeeded(config, logger, state)) {
      return;
    }
    const claimedWork: boolean = await runWorkerIteration(config, runtime, logger);
    state.hasReachedApi = true;
    if (!claimedWork) {
      await waitForNextPoll(config.pollIntervalMs);
    }
  } catch (error) {
    await handleWorkerIterationError(config, logger, state, error as WorkerCaughtError);
  }
}

async function recoverWorkerBuildClaimsIfNeeded(
  config: WorkerConfig,
  logger: pino.Logger<never, boolean>,
  state: WorkerState,
): Promise<boolean> {
  if (state.recoveredOrphanedBuildClaims) {
    return false;
  }
  const recovery: WorkerRecoverOrphanedBuildClaimsResponse = await recoverOrphanedBuildClaims(
    createCompartmentRequester({ apiUrl: config.apiUrl, internalToken: config.runtimeControlToken }),
  );
  state.hasReachedApi = true;
  state.recoveredOrphanedBuildClaims = true;
  if (recovery.requeuedDeploymentCount > 0) {
    logger.warn(recovery, 'Requeued orphaned deployment build claims before polling.');
  }
  return true;
}

async function handleWorkerIterationError(
  config: WorkerConfig,
  logger: pino.Logger<never, boolean>,
  state: WorkerState,
  error: WorkerCaughtError,
): Promise<void> {
  state.hasReachedApi = state.hasReachedApi || (error instanceof Error && isCompartmentRequestError(error));
  if (shouldWarnOnWorkerStartupRetry(error, state.hasReachedApi)) {
    logger.warn(buildWorkerCaughtErrorLogPayload(error), 'Worker startup dependency is not ready yet. Retrying.');
  } else {
    logger.error(buildWorkerCaughtErrorLogPayload(error), 'Worker iteration failed.');
  }
  await waitForNextPoll(config.pollIntervalMs);
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

async function waitForNextPoll(pollIntervalMs: number): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, pollIntervalMs);
  });
}
