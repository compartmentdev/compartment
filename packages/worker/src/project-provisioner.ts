import { setTimeout as delay } from 'node:timers/promises';
import type { ProjectProvisioningTarget, WorkerCompleteProjectProvisioningRequest } from '@compartment/contracts';
import {
  createSelfCleaningKubeRuntimeFromEnvironment,
  projectProvisioningAuthorityBundle,
  projectProvisioningAuthorityCleanup,
  type KubeJobResult,
  type KubeJobSpec,
  type ProjectProvisioningAuthorityInput,
  type KubeRuntime,
} from '@compartment/kube-runtime';
import {
  claimProjectProvisioning,
  completeProjectProvisioning,
  createCompartmentRequester,
  type CompartmentRequester,
} from '@compartment/sdk';
import pino, { type Logger } from 'pino';
import { readProjectProvisionerConfig } from './project-provisioner-config';
import type { ProjectProvisionerConfig } from './project-provisioner.types';

const bootstrapTokenExpirationSeconds: number = 600;
const provisioningTimeoutMs: number = 5 * 60_000;

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
  const jobId: string = `project-provision-${target.projectId}`;
  const authority: ProjectProvisioningAuthorityInput = {
    jobId,
    namespace: config.platformNamespace,
    serviceAccountName: config.bootstrapServiceAccountName,
  };
  const completion: WorkerCompleteProjectProvisioningRequest = await executeProjectProvisioning(
    runtime,
    config,
    target,
    jobId,
    authority,
  );
  await completeProjectProvisioning(request, completion);
  logger.info({ projectId: target.projectId, status: completion.status }, 'Project provisioning completed.');
}

async function executeProjectProvisioning(
  runtime: KubeRuntime,
  config: ProjectProvisionerConfig,
  target: ProjectProvisioningTarget,
  jobId: string,
  authority: ProjectProvisioningAuthorityInput,
): Promise<WorkerCompleteProjectProvisioningRequest> {
  try {
    await runtime.apply(projectProvisioningAuthorityBundle(authority));
    const result: KubeJobResult = await runtime.runJob(projectProvisioningJob(config, target, jobId));
    try {
      return projectProvisioningCompletion(target, result);
    } finally {
      await result.finalize();
    }
  } catch (error) {
    const message: string = error instanceof Error ? error.message : 'Project provisioning failed.';
    return failedProjectProvisioningCompletion(target, message);
  } finally {
    await runtime.apply(projectProvisioningAuthorityCleanup(authority));
  }
}

function failedProjectProvisioningCompletion(
  target: ProjectProvisioningTarget,
  message: string,
): WorkerCompleteProjectProvisioningRequest {
  return {
    leaseId: target.leaseId,
    message,
    projectId: target.projectId,
    status: 'failed',
  };
}

function projectProvisioningCompletion(
  target: ProjectProvisioningTarget,
  result: KubeJobResult,
): WorkerCompleteProjectProvisioningRequest {
  if (result.status === 'succeeded') {
    return { leaseId: target.leaseId, projectId: target.projectId, status: 'succeeded' };
  }
  return {
    leaseId: target.leaseId,
    message: result.logs.trim() !== '' ? result.logs.trim() : `Project provisioning Job ${result.status}.`,
    projectId: target.projectId,
    status: 'failed',
  };
}

function projectProvisioningJob(
  config: ProjectProvisionerConfig,
  target: ProjectProvisioningTarget,
  jobId: string,
): KubeJobSpec {
  return {
    command: ['node', 'dist/project-provisioner-job.js'],
    env: projectProvisioningEnvironment(config, target),
    id: jobId,
    image: config.image,
    jobClass: 'operation',
    labels: { 'compartment.dev/project-id': target.projectId, 'compartment.dev/job-class': 'project-provisioning' },
    namespace: config.platformNamespace,
    serviceAccountName: config.bootstrapServiceAccountName,
    serviceAccountTokenExpirationSeconds: bootstrapTokenExpirationSeconds,
    timeoutMs: provisioningTimeoutMs,
  };
}

function projectProvisioningEnvironment(
  config: ProjectProvisionerConfig,
  target: ProjectProvisioningTarget,
): Record<string, string> {
  const registryUrl: URL = new URL(`http://${config.artifactRegistry.address}`);
  return {
    COMPARTMENT_ARTIFACT_REGISTRY_HOST: registryUrl.hostname,
    COMPARTMENT_ARTIFACT_REGISTRY_PORT: registryUrl.port,
    COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD: config.artifactRegistry.readCredentials.password,
    COMPARTMENT_ARTIFACT_REGISTRY_READ_USERNAME: config.artifactRegistry.readCredentials.username,
    COMPARTMENT_BOOTSTRAP_SERVICE_ACCOUNT_NAME: config.bootstrapServiceAccountName,
    COMPARTMENT_EDGE_NAMESPACE: config.edgeNamespace,
    COMPARTMENT_KUBE_POD_CIDR: config.podCidr,
    COMPARTMENT_KUBE_SERVICE_CIDR: config.serviceCidr,
    COMPARTMENT_PLATFORM_NAMESPACE: config.platformNamespace,
    COMPARTMENT_PROJECT_ID: target.projectId,
    COMPARTMENT_WORKER_SERVICE_ACCOUNT_NAME: config.workerServiceAccountName,
  };
}
