import { setTimeout as delay } from 'node:timers/promises';
import type { ProjectProvisioningTarget, WorkerCompleteProjectProvisioningRequest } from '@compartment/contracts';
import { createSelfCleaningKubeRuntimeFromEnvironment, type KubeRuntime } from '@compartment/kube-runtime';
import {
  claimProjectProvisioning,
  completeProjectProvisioning,
  createCompartmentRequester,
  type CompartmentRequester,
} from '@compartment/sdk';
import pino, { type Logger } from 'pino';
import { readProjectProvisionerConfig } from './project-provisioner-config';
import type { ProjectProvisionerConfig } from './project-provisioner.types';
import { executeProjectProvisioning } from './services/project-provisioning-execution.service';

export async function runProjectProvisioner(): Promise<void> {
  const config: ProjectProvisionerConfig = readProjectProvisionerConfig();
  const logger: Logger = pino({ level: config.logLevel }).child({ service: 'project-provisioner' });
  const request: CompartmentRequester = createCompartmentRequester({
    apiUrl: config.apiUrl,
    internalToken: config.runtimeControlToken,
  });
  const runtime: KubeRuntime = createSelfCleaningKubeRuntimeFromEnvironment();
  await runProjectProvisioningLoop(config, logger, request, runtime);
}

async function runProjectProvisioningLoop(
  config: ProjectProvisionerConfig,
  logger: Logger,
  request: CompartmentRequester,
  runtime: KubeRuntime,
): Promise<void> {
  for (;;) {
    try {
      const claimed: ProjectProvisioningTarget | null = (await claimProjectProvisioning(request)).target;
      if (claimed === null) {
        await delay(config.pollIntervalMs);
        continue;
      }
      await provisionClaimedProject(request, runtime, config, claimed, logger);
    } catch (error) {
      logger.error({ err: error }, 'Project provisioner iteration failed.');
      await delay(config.pollIntervalMs);
    }
  }
}

async function provisionClaimedProject(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  config: ProjectProvisionerConfig,
  target: ProjectProvisioningTarget,
  logger: Logger,
): Promise<void> {
  const completion: WorkerCompleteProjectProvisioningRequest = await executeProjectProvisioning(
    runtime,
    config,
    target,
    logger,
  );
  await completeProjectProvisioning(request, completion);
  logger.info(
    { action: target.action, projectId: target.projectId, status: completion.status },
    'Project provisioning completed.',
  );
}
