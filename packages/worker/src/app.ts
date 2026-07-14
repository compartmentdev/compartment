import pino from 'pino';
import type { WorkerRecoverDeploymentsMode, WorkerRecoverDeploymentsResponse } from '@compartment/contracts';
import { prewarmSourceBuildToolchain } from '@compartment/docker';
import {
  createCompartmentRequester,
  isCompartmentRequestError,
  recoverRunningDeployments,
  type CompartmentRequester,
} from '@compartment/sdk';
import { readWorkerConfig, type WorkerConfig } from './config';
import { buildWorkerCaughtErrorLogPayload } from './logging/worker-error-log';
import type { WorkerCaughtError } from './logging/worker-error-log.types';
import { cleanupWorkerArtifacts } from './services/worker-artifact-cleanup.service';
import { runWorkerIteration } from './services/worker.service';
import { createKubeControllerHost, type KubeControllerHost } from './kube-controller-host';
import { runKubeControllerLoop } from './kube-controller-loop';

interface WorkerRuntimeState {
  hasReachedApi: boolean;
  recoveredOrphanedDeployments: boolean;
}

interface WorkerFetchError extends Error {
  cause?: {
    code?: string | undefined;
  };
}

export async function runWorker(config: WorkerConfig = readWorkerConfig()): Promise<void> {
  const logger: pino.Logger<never, boolean> = createWorkerLogger(config);
  const state: WorkerRuntimeState = createWorkerRuntimeState();
  const kubeController: KubeControllerHost = createKubeControllerHost(config);

  void prewarmSourceBuildToolchainAtStartup(logger);
  if (kubeController.enabled) {
    void runKubeControllerLoop(config, logger, kubeController);
  }
  await runWorkerLoop(config, logger, state);
}

function createWorkerLogger(config: WorkerConfig): pino.Logger<never, boolean> {
  return pino({
    level: config.logLevel,
    base: {
      service: 'worker',
    },
  });
}

function createWorkerRuntimeState(): WorkerRuntimeState {
  return {
    hasReachedApi: false,
    recoveredOrphanedDeployments: false,
  };
}

async function prewarmSourceBuildToolchainAtStartup(logger: pino.Logger<never, boolean>): Promise<void> {
  logger.info('Prewarming source build toolchain.');

  try {
    await prewarmSourceBuildToolchain();
    logger.info('Source build toolchain prewarmed.');
  } catch (error) {
    logger.warn(
      buildWorkerCaughtErrorLogPayload(error as WorkerCaughtError),
      'Source build toolchain prewarm failed. First source deploy on this node may be slower.',
    );
  }
}

async function runWorkerLoop(
  config: WorkerConfig,
  logger: pino.Logger<never, boolean>,
  state: WorkerRuntimeState,
): Promise<void> {
  for (;;) {
    await runWorkerCycle(config, logger, state);
  }
}

async function runWorkerCycle(
  config: WorkerConfig,
  logger: pino.Logger<never, boolean>,
  state: WorkerRuntimeState,
): Promise<void> {
  try {
    const didRunStartupRecovery: boolean = await recoverWorkerStartupStateIfNeeded(config, logger, state);
    if (!didRunStartupRecovery) {
      await recoverPendingDrainStateIfNeeded(config, logger, state);
    }
    await pollWorkerDeployments(config, state);
  } catch (error) {
    await handleWorkerIterationError(config, logger, state, error as WorkerCaughtError);
  }
}

async function recoverWorkerStartupStateIfNeeded(
  config: WorkerConfig,
  logger: pino.Logger<never, boolean>,
  state: WorkerRuntimeState,
): Promise<boolean> {
  if (state.recoveredOrphanedDeployments) {
    return false;
  }

  const recoveredDeploymentCount: number = await recoverRunningDeploymentsForMode(config, 'all');
  state.hasReachedApi = true;
  state.recoveredOrphanedDeployments = true;
  if (recoveredDeploymentCount > 0) {
    logger.warn({ recoveredDeploymentCount }, 'Finalized orphaned running deployments before worker polling.');
  }

  return true;
}

async function recoverPendingDrainStateIfNeeded(
  config: WorkerConfig,
  logger: pino.Logger<never, boolean>,
  state: WorkerRuntimeState,
): Promise<void> {
  if (!state.recoveredOrphanedDeployments) {
    return;
  }

  try {
    const recoveredDeploymentCount: number = await recoverRunningDeploymentsForMode(config, 'pending-drain');
    state.hasReachedApi = true;
    if (recoveredDeploymentCount > 0) {
      logger.warn({ recoveredDeploymentCount }, 'Recovered pending deployment drains before worker polling.');
    }
  } catch (error) {
    logger.warn(
      buildWorkerCaughtErrorLogPayload(error as WorkerCaughtError),
      'Pending deployment drain recovery failed. Worker polling will continue.',
    );
  }
}

async function recoverRunningDeploymentsForMode(
  config: WorkerConfig,
  mode: WorkerRecoverDeploymentsMode,
): Promise<number> {
  const request: CompartmentRequester = createCompartmentRequester({
    apiUrl: config.apiUrl,
    internalToken: config.runtimeControlToken,
  });
  const response: WorkerRecoverDeploymentsResponse = await recoverRunningDeployments(request, { mode });
  await cleanupWorkerArtifacts(response.cleanupArtifacts, config.artifactRegistry, config.dockerNamespace);

  return response.recoveredDeploymentCount;
}

async function pollWorkerDeployments(config: WorkerConfig, state: WorkerRuntimeState): Promise<void> {
  const claimedWork: boolean = await runWorkerIteration(
    config.apiUrl,
    config.runtimeControlToken,
    config.dockerNamespace,
    config.artifactRegistry,
  );
  state.hasReachedApi = true;
  if (!claimedWork) {
    await waitForNextPoll(config.pollIntervalMs);
  }
}

async function handleWorkerIterationError(
  config: WorkerConfig,
  logger: pino.Logger<never, boolean>,
  state: WorkerRuntimeState,
  error: WorkerCaughtError,
): Promise<void> {
  state.hasReachedApi = state.hasReachedApi || didReachApi(error);
  if (shouldWarnOnWorkerStartupRetry(error, state.hasReachedApi)) {
    logger.warn(buildWorkerCaughtErrorLogPayload(error), 'Worker startup dependency is not ready yet. Retrying.');
  } else {
    logger.error(buildWorkerCaughtErrorLogPayload(error), 'Worker iteration failed.');
  }
  await waitForNextPoll(config.pollIntervalMs);
}

function shouldWarnOnWorkerStartupRetry(error: WorkerCaughtError, hasReachedApi: boolean): boolean {
  if (isCompartmentNotInstalledError(error)) {
    return true;
  }

  return !hasReachedApi && isApiConnectionRefusedError(error);
}

function isCompartmentNotInstalledError(error: WorkerCaughtError): boolean {
  return error instanceof Error && isCompartmentRequestError(error) && error.code === 'not_installed';
}

function didReachApi(error: WorkerCaughtError): boolean {
  return error instanceof Error && isCompartmentRequestError(error);
}

function isApiConnectionRefusedError(error: WorkerCaughtError): boolean {
  return error instanceof Error && readWorkerErrorCauseCode(error) === 'ECONNREFUSED';
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
