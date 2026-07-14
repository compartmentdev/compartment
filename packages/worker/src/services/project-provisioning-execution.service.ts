import type { ProjectProvisioningTarget, WorkerCompleteProjectProvisioningRequest } from '@compartment/contracts';
import {
  kubeNamespaceName,
  projectProvisioningAuthorityBundle,
  projectProvisioningAuthorityCleanup,
  type KubeJobResult,
  type KubeJobSpec,
  type ProjectProvisioningAuthorityInput,
  type KubeRuntime,
} from '@compartment/kube-runtime';
import type { Logger } from 'pino';
import type { ProjectProvisionerConfig } from '../project-provisioner.types';

const bootstrapTokenExpirationSeconds: number = 600;
const provisioningTimeoutMs: number = 5 * 60_000;

export async function executeProjectProvisioning(
  runtime: KubeRuntime,
  config: ProjectProvisionerConfig,
  target: ProjectProvisioningTarget,
  logger: Logger,
): Promise<WorkerCompleteProjectProvisioningRequest> {
  const authority: ProjectProvisioningAuthorityInput = projectProvisioningAuthority(config, target);
  let result: KubeJobResult | null = null;
  let completion: WorkerCompleteProjectProvisioningRequest;
  try {
    await runtime.apply(projectProvisioningAuthorityBundle(authority));
    result = await runtime.runJob(projectProvisioningJob(config, target, authority));
    completion = projectProvisioningCompletion(target, result);
  } catch (error) {
    completion = failedProjectProvisioningCompletion(
      target,
      readErrorMessage(typeof error === 'object' ? error : null),
    );
  }
  await cleanupProjectProvisioning(runtime, authority, result, logger);
  return completion;
}

async function cleanupProjectProvisioning(
  runtime: KubeRuntime,
  authority: ProjectProvisioningAuthorityInput,
  result: KubeJobResult | null,
  logger: Logger,
): Promise<void> {
  if (result !== null) {
    const jobResult: KubeJobResult = result;
    await logCleanupFailure(logger, 'Project provisioning Job finalization failed.', async (): Promise<void> => {
      await jobResult.finalize();
    });
  }
  await logCleanupFailure(logger, 'Project provisioning authority cleanup failed.', async (): Promise<void> => {
    await runtime.apply(projectProvisioningAuthorityCleanup(authority));
  });
}

async function logCleanupFailure(logger: Logger, message: string, cleanup: () => Promise<void>): Promise<void> {
  try {
    await cleanup();
  } catch (error) {
    logger.warn({ err: error }, message);
  }
}

function readErrorMessage(error: object | null): string {
  return error instanceof Error ? error.message : 'Project provisioning failed.';
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
  authority: ProjectProvisioningAuthorityInput,
): KubeJobSpec {
  return {
    command: ['node', 'dist/project-provisioner-job.js'],
    env: projectProvisioningEnvironment(config, target, authority.serviceAccountName),
    id: authority.jobId,
    image: config.image,
    jobClass: 'operation',
    labels: { 'compartment.dev/project-id': target.projectId, 'compartment.dev/job-class': 'project-provisioning' },
    namespace: authority.namespace,
    securityProfile: 'restricted',
    serviceAccountName: authority.serviceAccountName,
    serviceAccountTokenExpirationSeconds: bootstrapTokenExpirationSeconds,
    timeoutMs: provisioningTimeoutMs,
  };
}

function projectProvisioningAuthority(
  config: ProjectProvisionerConfig,
  target: ProjectProvisioningTarget,
): ProjectProvisioningAuthorityInput {
  return {
    jobId: `project-provision-${target.projectId}`,
    namespace: config.provisioningNamespace,
    serviceAccountName: kubeNamespaceName(target.projectId),
  };
}

function projectProvisioningEnvironment(
  config: ProjectProvisionerConfig,
  target: ProjectProvisioningTarget,
  bootstrapServiceAccountName: string,
): Record<string, string> {
  const registryUrl: URL = new URL(`http://${config.artifactRegistry.address}`);
  return {
    COMPARTMENT_ARTIFACT_REGISTRY_HOST: registryUrl.hostname,
    COMPARTMENT_ARTIFACT_REGISTRY_PORT: registryUrl.port,
    COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD: config.artifactRegistry.readCredentials.password,
    COMPARTMENT_ARTIFACT_REGISTRY_READ_USERNAME: config.artifactRegistry.readCredentials.username,
    COMPARTMENT_BOOTSTRAP_SERVICE_ACCOUNT_NAME: bootstrapServiceAccountName,
    COMPARTMENT_EDGE_NAMESPACE: config.edgeNamespace,
    COMPARTMENT_KUBE_POD_CIDR: config.podCidr,
    COMPARTMENT_KUBE_SERVICE_CIDR: config.serviceCidr,
    COMPARTMENT_PLATFORM_NAMESPACE: config.platformNamespace,
    COMPARTMENT_PROJECT_ID: target.projectId,
    COMPARTMENT_PROVISIONING_NAMESPACE: config.provisioningNamespace,
    COMPARTMENT_WORKER_SERVICE_ACCOUNT_NAME: config.workerServiceAccountName,
  };
}
