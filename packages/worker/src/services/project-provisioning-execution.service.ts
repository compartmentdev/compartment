import type { ProjectProvisioningTargetV2, WorkerCompleteProjectProvisioningV2Request } from '@compartment/contracts';
import {
  kubeNamespaceName,
  projectNamespaceDeleteTarget,
  projectProvisioningAuthorityBundle,
  type KubeJobResult,
  type KubeJobSpec,
  type KubeManifest,
  type KubeObservedManifest,
  type ProjectProvisioningAuthorityInput,
  type KubeRuntime,
} from '@compartment/kube-runtime';
import type { CompartmentRequester } from '@compartment/sdk';
import type { Logger } from 'pino';
import { projectProvisionerJobEnvironment } from '../project-provisioning-environment';
import type { ProjectProvisionerConfig } from '../project-provisioner.types';
import type { ProjectProvisioningResult } from './project-provisioning-execution.service.types';
import { cleanupProjectProvisioningAuthority } from './project-provisioning-authority-cleanup.service';
import {
  assertProjectProvisioningLease,
  rethrowProjectProvisioningLeaseError,
} from './project-provisioning-lease.service';
import {
  failedProjectProvisioningCompletion,
  finalizeProjectProvisioningJob,
  projectProvisioningCompletion,
} from './project-provisioning-finalization.service';
import { waitForProjectNamespaceDeletion } from './project-teardown-wait.service';

const bootstrapTokenExpirationSeconds: number = 600;
const provisioningTimeoutMs: number = 5 * 60_000;
const teardownPollIntervalMs: number = 100;
const teardownTimeoutMs: number = 30_000;
// Two hours accommodates slow Kubernetes finalizers while bounding the single serial provisioner attempt.
const projectNamespaceTeardownAbsoluteTimeoutMs: number = 2 * 60 * 60_000;

export async function executeProjectProvisioning(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  config: ProjectProvisionerConfig,
  target: ProjectProvisioningTargetV2,
  logger: Logger,
): Promise<WorkerCompleteProjectProvisioningV2Request> {
  return target.action === 'provision'
    ? await executeProjectProvisioningWork(request, runtime, config, target, logger)
    : await executeProjectTeardown(request, runtime, config, target, logger);
}

async function executeProjectProvisioningWork(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  config: ProjectProvisionerConfig,
  target: ProjectProvisioningTargetV2,
  logger: Logger,
): Promise<WorkerCompleteProjectProvisioningV2Request> {
  const authority: ProjectProvisioningAuthorityInput = projectProvisioningAuthority(config, target);
  await assertProjectProvisioningLease(request, target);
  try {
    await runtime.apply(projectProvisioningAuthorityBundle(authority));
  } catch (error) {
    const completion: ProjectProvisioningResult = failedProjectProvisioningCompletion(
      readErrorMessage(typeof error === 'object' ? error : null),
    );
    await cleanupProjectProvisioningAuthority(request, runtime, authority, target, logger);
    return projectProvisioningRequest(target, completion);
  }
  const result: KubeJobResult = await runtime.runJob(projectProvisioningJob(config, target, authority));
  const cleanupAuthority: () => Promise<void> = async (): Promise<void> => {
    await cleanupProjectProvisioningAuthority(request, runtime, authority, target, logger);
  };
  await finalizeProjectProvisioningJob(result, cleanupAuthority);
  return projectProvisioningRequest(target, projectProvisioningCompletion(result));
}

async function executeProjectTeardown(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  config: ProjectProvisionerConfig,
  target: ProjectProvisioningTargetV2,
  logger: Logger,
): Promise<WorkerCompleteProjectProvisioningV2Request> {
  try {
    await assertProjectProvisioningLease(request, target);
    const cleanup: KubeManifest[] = await cleanupProjectTeardownAuthority(request, runtime, config, target, logger);
    await waitForKubeObjectsDeletion(runtime, cleanup);
    await assertProjectProvisioningLease(request, target);
    const namespace: KubeManifest = projectNamespaceDeleteTarget(target.namespaceId);
    await runtime.delete([namespace]);
    await waitForNamespaceDeletion(request, runtime, namespace, target);
    await assertProjectProvisioningLease(request, target);
    return projectProvisioningRequest(target, { status: 'succeeded' });
  } catch (error) {
    rethrowProjectProvisioningLeaseError(typeof error === 'object' ? error : null);
    return projectProvisioningRequest(target, {
      message: readErrorMessage(typeof error === 'object' ? error : null),
      status: 'failed',
    });
  }
}

async function waitForNamespaceDeletion(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  namespace: KubeManifest,
  target: ProjectProvisioningTargetV2,
): Promise<void> {
  await waitForProjectNamespaceDeletion(
    runtime,
    namespace,
    async (): Promise<void> => await assertProjectProvisioningLease(request, target),
    projectNamespaceTeardownAbsoluteTimeoutMs,
  );
}

async function cleanupProjectTeardownAuthority(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  config: ProjectProvisionerConfig,
  target: ProjectProvisioningTargetV2,
  logger: Logger,
): Promise<KubeManifest[]> {
  return await cleanupProjectProvisioningAuthority(
    request,
    runtime,
    projectProvisioningAuthority(config, target),
    target,
    logger,
  );
}

async function waitForKubeObjectsDeletion(runtime: KubeRuntime, objects: KubeManifest[]): Promise<void> {
  const deadline: number = Date.now() + teardownTimeoutMs;
  while (Date.now() < deadline) {
    const observed: (KubeObservedManifest | null)[] = await Promise.all(
      objects.map(async (object: KubeManifest): Promise<KubeObservedManifest | null> => await runtime.read(object)),
    );
    if (
      observed.every((object: KubeObservedManifest | null, index: number): boolean =>
        deletedObjectIsAbsent(objects[index]!, object),
      )
    ) {
      return;
    }
    await waitForTeardownPoll();
  }
  throw new Error('Project Kubernetes authority objects cleanup did not converge.');
}

async function waitForTeardownPoll(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, teardownPollIntervalMs);
  });
}

function deletedObjectIsAbsent(expected: KubeManifest, observed: KubeObservedManifest | null): boolean {
  const expectedUid: string | undefined = expected.metadata?.uid;
  return observed === null || (expectedUid !== undefined && observed.metadata?.uid !== expectedUid);
}

function projectProvisioningRequest(
  target: ProjectProvisioningTargetV2,
  completion: ProjectProvisioningResult,
): WorkerCompleteProjectProvisioningV2Request {
  return {
    ...completion,
    action: target.action,
    isolationVersion: target.isolationVersion,
    leaseId: target.leaseId,
    projectId: target.projectId,
  };
}

function readErrorMessage(error: object | null): string {
  return error instanceof Error ? error.message : 'Project provisioning failed.';
}

function projectProvisioningJob(
  config: ProjectProvisionerConfig,
  target: ProjectProvisioningTargetV2,
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
    scheduling: config.tenantScheduling,
    securityProfile: 'restricted',
    serviceAccountName: authority.serviceAccountName,
    serviceAccountTokenExpirationSeconds: bootstrapTokenExpirationSeconds,
    timeoutMs: provisioningTimeoutMs,
  };
}

function projectProvisioningAuthority(
  config: ProjectProvisionerConfig,
  target: ProjectProvisioningTargetV2,
): ProjectProvisioningAuthorityInput {
  return {
    jobId: `project-provision-${target.projectId}`,
    namespace: config.provisioningNamespace,
    serviceAccountName: kubeNamespaceName(target.projectId),
  };
}
