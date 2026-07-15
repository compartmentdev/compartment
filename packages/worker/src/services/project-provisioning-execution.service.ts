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
import { projectProvisionerJobEnvironment } from '../project-provisioning-environment';
import type { ProjectProvisionerConfig } from '../project-provisioner.types';
import type { ProjectProvisioningResult } from './project-provisioning-execution.service.types';

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
  let completion: ProjectProvisioningResult;
  await cleanupProjectProvisioningAuthority(runtime, authority, logger);
  try {
    await runtime.apply(projectProvisioningAuthorityBundle(authority));
    result = await runtime.runJob(projectProvisioningJob(config, target, authority));
    completion = projectProvisioningCompletion(result);
  } catch (error) {
    completion = failedProjectProvisioningCompletion(readErrorMessage(typeof error === 'object' ? error : null));
  }
  await cleanupProjectProvisioning(runtime, authority, result, logger);
  return {
    ...completion,
    action: 'provision',
    leaseId: target.leaseId,
    projectId: target.projectId,
  };
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
  await cleanupProjectProvisioningAuthority(runtime, authority, logger);
}

async function cleanupProjectProvisioningAuthority(
  runtime: KubeRuntime,
  authority: ProjectProvisioningAuthorityInput,
  logger: Logger,
): Promise<void> {
  try {
    await runtime.apply(projectProvisioningAuthorityCleanup(authority));
  } catch (error) {
    logger.warn({ err: error }, 'Project provisioning authority cleanup failed.');
    throw error;
  }
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
  target: ProjectProvisioningTarget,
  authority: ProjectProvisioningAuthorityInput,
): KubeJobSpec {
  return {
    command: ['node', 'dist/project-provisioner-job.js'],
    env: { ...projectProvisionerJobEnvironment(config, target, authority.serviceAccountName) },
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
