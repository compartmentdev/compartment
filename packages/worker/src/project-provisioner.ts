import type { ProjectProvisioningTargetV2, WorkerCompleteProjectProvisioningV2Request } from '@compartment/contracts';
import {
  createKubeLeaderElectionFromEnvironment,
  createSelfCleaningKubeRuntimeFromEnvironment,
  type KubeLeaderElector,
  type KubeRuntime,
} from '@compartment/kube-runtime';
import {
  claimProjectProvisioningV2,
  completeProjectProvisioningV2,
  createCompartmentRequester,
  type CompartmentRequester,
} from '@compartment/sdk';
import { waitForAbortOrTimeout } from '@compartment/utils';
import type { PrometheusMetricsServer } from '@compartment/utils/metrics';
import pino, { type Logger } from 'pino';
import { readProjectProvisionerConfig } from './project-provisioner-config';
import type { ProjectProvisionerConfig } from './project-provisioner.types';
import { executeProjectProvisioning } from './services/project-provisioning-execution.service';
import {
  recordProjectProvisioningAttempt,
  setProjectProvisioningAttemptActive,
  startProjectProvisionerPlatformMetrics,
} from './services/project-provisioner-platform-metrics.service';

export async function runProjectProvisioner(): Promise<void> {
  const config: ProjectProvisionerConfig = readProjectProvisionerConfig();
  const logger: Logger = pino({ level: config.logLevel }).child({ service: 'project-provisioner' });
  const request: CompartmentRequester = createCompartmentRequester({
    apiUrl: config.apiUrl,
    internalToken: config.runtimeControlToken,
  });
  const runtime: KubeRuntime = createSelfCleaningKubeRuntimeFromEnvironment();
  const election: KubeLeaderElector = createKubeLeaderElectionFromEnvironment(config.leaderElection, {
    onError: (error: Error): void => logger.warn({ err: error }, 'Project provisioner leader election retrying.'),
    onLeader: (): void => logger.info('Project provisioner acquired leadership.'),
    onStandby: (): void => logger.info('Project provisioner is standing by.'),
  });
  const shutdown: AbortController = createShutdownController();
  const metricsServer: PrometheusMetricsServer = await startProjectProvisionerPlatformMetrics(config.metricsPort);
  try {
    await election.run(
      async (signal: AbortSignal): Promise<void> =>
        await runProjectProvisioningLoop(config, logger, request, runtime, signal),
      shutdown.signal,
    );
  } finally {
    await metricsServer.close();
  }
}

async function runProjectProvisioningLoop(
  config: ProjectProvisionerConfig,
  logger: Logger,
  request: CompartmentRequester,
  runtime: KubeRuntime,
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    try {
      const claimed: ProjectProvisioningTargetV2 | null = (await claimProjectProvisioningV2(request)).target;
      if (claimed === null) {
        await waitForAbortOrTimeout(config.pollIntervalMs, signal);
        continue;
      }
      await provisionClaimedProject(request, runtime, config, claimed, logger);
    } catch (error) {
      logger.error({ err: error }, 'Project provisioner iteration failed.');
      await waitForAbortOrTimeout(config.pollIntervalMs, signal);
    }
  }
}

function createShutdownController(): AbortController {
  const controller: AbortController = new AbortController();
  const stop: () => void = (): void => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return controller;
}

async function provisionClaimedProject(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  config: ProjectProvisionerConfig,
  target: ProjectProvisioningTargetV2,
  logger: Logger,
): Promise<void> {
  setProjectProvisioningAttemptActive(true);
  try {
    const completion: WorkerCompleteProjectProvisioningV2Request = await executeProjectProvisioning(
      request,
      runtime,
      config,
      target,
      logger,
    );
    await completeProjectProvisioningV2(request, completion);
    recordProjectProvisioningAttempt(completion.status === 'failed' ? 'failed' : 'succeeded');
    logger.info({ projectId: target.projectId, status: completion.status }, 'Project provisioning completed.');
  } catch (error) {
    recordProjectProvisioningAttempt('failed');
    throw error;
  } finally {
    setProjectProvisioningAttemptActive(false);
  }
}
