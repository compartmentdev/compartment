import type {
  ProjectProvisioningCleanupTarget,
  ProjectProvisioningExecutionTarget,
  ProjectProvisioningTarget,
  WorkerCompleteProjectProvisioningRequest,
} from '@compartment/contracts';
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
import type { ProjectProvisioningResult } from './project-provisioning-execution.service.types';

const bootstrapTokenExpirationSeconds: number = 600;
const provisioningTimeoutMs: number = 5 * 60_000;

export async function executeProjectProvisioning(
  runtime: KubeRuntime,
  config: ProjectProvisionerConfig,
  target: ProjectProvisioningExecutionTarget,
  logger: Logger,
): Promise<WorkerCompleteProjectProvisioningRequest> {
  const authority: ProjectProvisioningAuthorityInput = projectProvisioningAuthority(config, target);
  let result: KubeJobResult | null = null;
  let completion: ProjectProvisioningResult;
  try {
    await runtime.apply(projectProvisioningAuthorityBundle(authority));
    result = await runtime.runJob(projectProvisioningJob(config, target, authority));
    completion = projectProvisioningCompletion(result);
  } catch (error) {
    completion = failedProjectProvisioningCompletion(readErrorMessage(typeof error === 'object' ? error : null));
  }
  const cleanupRequired: boolean = await cleanupProjectProvisioning(runtime, authority, result, logger);
  return {
    ...completion,
    action: 'provision',
    cleanupRequired,
    leaseId: target.leaseId,
    projectId: target.projectId,
  };
}

export async function executeProjectProvisioningCleanup(
  runtime: KubeRuntime,
  config: ProjectProvisionerConfig,
  target: ProjectProvisioningCleanupTarget,
  logger: Logger,
): Promise<WorkerCompleteProjectProvisioningRequest> {
  try {
    await runtime.apply(projectProvisioningAuthorityCleanup(projectProvisioningAuthority(config, target)));
    return { action: 'cleanup', leaseId: target.leaseId, projectId: target.projectId, status: 'succeeded' };
  } catch (error) {
    logger.warn({ err: error }, 'Project provisioning authority cleanup retry failed.');
    return {
      action: 'cleanup',
      leaseId: target.leaseId,
      message: readErrorMessage(typeof error === 'object' ? error : null),
      projectId: target.projectId,
      status: 'failed',
    };
  }
}

async function cleanupProjectProvisioning(
  runtime: KubeRuntime,
  authority: ProjectProvisioningAuthorityInput,
  result: KubeJobResult | null,
  logger: Logger,
): Promise<boolean> {
  if (result !== null) {
    const jobResult: KubeJobResult = result;
    await logCleanupFailure(logger, 'Project provisioning Job finalization failed.', async (): Promise<void> => {
      await jobResult.finalize();
    });
  }
  const cleaned: boolean = await logCleanupFailure(
    logger,
    'Project provisioning authority cleanup failed.',
    async (): Promise<void> => {
      await runtime.apply(projectProvisioningAuthorityCleanup(authority));
    },
  );
  return !cleaned;
}

async function logCleanupFailure(logger: Logger, message: string, cleanup: () => Promise<void>): Promise<boolean> {
  try {
    await cleanup();
    return true;
  } catch (error) {
    logger.warn({ err: error }, message);
    return false;
  }
}

function readErrorMessage(error: object | null): string {
  return error instanceof Error ? error.message : 'Project provisioning failed.';
}

function failedProjectProvisioningCompletion(message: string): ProjectProvisioningResult {
  return { message, status: 'failed' };
}

function projectProvisioningCompletion(result: KubeJobResult): ProjectProvisioningResult {
  if (result.status === 'succeeded') {
    return { status: 'succeeded' };
  }
  return {
    message: result.logs.trim() !== '' ? result.logs.trim() : `Project provisioning Job ${result.status}.`,
    status: 'failed',
  };
}

function projectProvisioningJob(
  config: ProjectProvisionerConfig,
  target: ProjectProvisioningExecutionTarget,
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
