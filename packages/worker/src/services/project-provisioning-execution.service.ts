import type {
  ProjectProvisioningTarget,
  WorkerCompleteProjectProvisioningRequest,
  WorkerCompleteProjectProvisioningResponse,
} from '@compartment/contracts';
import {
  kubeNamespaceName,
  projectProvisioningAuthorityBundle,
  projectProvisioningAuthorityCleanup,
  type KubeJobResult,
  type KubeJobSpec,
  type KubeManifest,
  type KubeObservedManifest,
  type ProjectProvisioningAuthorityInput,
  type KubeRuntime,
} from '@compartment/kube-runtime';
import { completeProjectProvisioning, type CompartmentRequester } from '@compartment/sdk';
import type { Logger } from 'pino';
import { projectProvisionerJobEnvironment } from '../project-provisioning-environment';
import type { ProjectProvisionerConfig } from '../project-provisioner.types';
import type { ProjectProvisioningResult } from './project-provisioning-execution.service.types';

const bootstrapTokenExpirationSeconds: number = 600;
const provisioningTimeoutMs: number = 5 * 60_000;

export async function executeProjectProvisioning(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  config: ProjectProvisionerConfig,
  target: ProjectProvisioningTarget,
  logger: Logger,
): Promise<WorkerCompleteProjectProvisioningRequest> {
  const authority: ProjectProvisioningAuthorityInput = projectProvisioningAuthority(config, target);
  let completion: ProjectProvisioningResult;
  await assertProjectProvisioningLease(request, target);
  try {
    await runtime.apply(projectProvisioningAuthorityBundle(authority));
  } catch (error) {
    completion = failedProjectProvisioningCompletion(readErrorMessage(typeof error === 'object' ? error : null));
    await cleanupProjectProvisioningAuthority(request, runtime, authority, target, logger);
    return projectProvisioningRequest(target, completion);
  }
  const result: KubeJobResult = await runtime.runJob(projectProvisioningJob(config, target, authority));
  completion = projectProvisioningCompletion(result);
  await cleanupProjectProvisioningAuthority(request, runtime, authority, target, logger);
  return projectProvisioningRequest(target, completion);
}

function projectProvisioningRequest(
  target: ProjectProvisioningTarget,
  completion: ProjectProvisioningResult,
): WorkerCompleteProjectProvisioningRequest {
  return { ...completion, generation: target.generation, leaseId: target.leaseId, projectId: target.projectId };
}

async function cleanupProjectProvisioningAuthority(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  authority: ProjectProvisioningAuthorityInput,
  target: ProjectProvisioningTarget,
  logger: Logger,
): Promise<void> {
  try {
    const cleanup: KubeManifest[] = await readProjectProvisioningCleanup(runtime, authority);
    await assertProjectProvisioningLease(request, target);
    await runtime.apply({ deleteAfterApply: cleanup, objects: [] });
  } catch (error) {
    logger.warn({ err: error }, 'Project provisioning authority cleanup failed.');
    throw error;
  }
}

async function assertProjectProvisioningLease(
  request: CompartmentRequester,
  target: ProjectProvisioningTarget,
): Promise<void> {
  const lease: WorkerCompleteProjectProvisioningResponse = await completeProjectProvisioning(request, {
    generation: target.generation,
    leaseId: target.leaseId,
    projectId: target.projectId,
    status: 'running',
  });
  if (!lease.applied) {
    throw new Error('Project provisioning lease is no longer current.');
  }
}

async function readProjectProvisioningCleanup(
  runtime: KubeRuntime,
  authority: ProjectProvisioningAuthorityInput,
): Promise<KubeManifest[]> {
  const cleanup: KubeManifest[] = projectProvisioningAuthorityCleanup(authority).deleteAfterApply ?? [];
  const observed: (KubeObservedManifest | null)[] = await Promise.all(
    cleanup.map(async (object: KubeManifest): Promise<KubeObservedManifest | null> => await runtime.read(object)),
  );
  return observed.filter(isCleanupManifest);
}

function isCleanupManifest(object: KubeObservedManifest | null): object is KubeManifest {
  return object !== null && object.kind !== 'Pod';
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
