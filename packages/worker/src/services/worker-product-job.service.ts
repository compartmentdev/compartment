import {
  productJobRuntimeId,
  type ProductJobIntent,
  type ProductJobClass,
  type WorkerPersistProductJobResultRequest,
  type WorkerPersistProductJobIntentResponse,
} from '@compartment/contracts';
import {
  type KubeJobResult,
  type KubeJobSpec,
  type KubePersistedJobResult,
  type KubeRuntime,
  type KubeWorkloadScheduling,
} from '@compartment/kube-runtime';
import {
  finalizeProductJob,
  persistProductJobIntent,
  persistProductJobResult,
  submitProductJob,
  type CompartmentRequester,
} from '@compartment/sdk';
import { fenceProductJobClaims, readProductJobIdentity } from './worker-product-job-fencing.service';
import { tenantJobSpec } from '../tenant-workload-projections';
import { decryptTenantSecretEnvironment, redactTenantSecretValues } from '../tenant-secret-environment';
import type { TenantSecretsKeyring } from '../tenant-secret-environment.types';

class ProductJobFailedError extends Error {
  public constructor(
    public readonly jobClass: ProductJobClass,
    public readonly identityId: string,
    public readonly status: 'failed' | 'timed-out',
  ) {
    super(`Product ${jobClass} job ${identityId} ${status === 'failed' ? 'failed' : 'timed out'}.`);
  }
}

export async function executeProductJob(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  intent: ProductJobIntent,
  tenantSecretsKek: TenantSecretsKeyring,
  scheduling?: KubeWorkloadScheduling,
): Promise<WorkerPersistProductJobResultRequest> {
  const persisted: WorkerPersistProductJobIntentResponse = await persistProductJobIntent(request, intent);
  const identityId: string = readProductJobIdentity(intent);
  requirePendingProductJob(persisted);
  const jobResult: KubeJobResult = await runFencedProductJob(
    request,
    runtime,
    intent,
    identityId,
    tenantSecretsKek,
    scheduling,
  );
  const result: WorkerPersistProductJobResultRequest = createJobResult(intent, identityId, jobResult, tenantSecretsKek);
  await settleProductJob(request, intent, result, jobResult);
  return result;
}

function requirePendingProductJob(persisted: WorkerPersistProductJobIntentResponse): void {
  if (persisted.result !== null) {
    throwProductJobFailure(persisted.result);
  }
}

async function settleProductJob(
  request: CompartmentRequester,
  intent: ProductJobIntent,
  result: WorkerPersistProductJobResultRequest,
  jobResult: KubeJobResult,
): Promise<void> {
  await persistProductJobResult(request, result);
  await jobResult.finalize();
  await finalizeProductJob(request, { identityId: result.identityId, jobClass: intent.jobClass });
  if (result.status !== 'succeeded') {
    throwProductJobFailure(result);
  }
}

function throwProductJobFailure(result: WorkerPersistProductJobResultRequest): never {
  if (result.status === 'succeeded') {
    throw new Error(`Product ${result.jobClass} job ${result.identityId} was already completed.`);
  }
  throw new ProductJobFailedError(result.jobClass, result.identityId, result.status);
}

async function runFencedProductJob(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  intent: ProductJobIntent,
  identityId: string,
  tenantSecretsKek: TenantSecretsKeyring,
  scheduling?: KubeWorkloadScheduling,
): Promise<KubeJobResult> {
  await fenceProductJobClaims(request, runtime, intent);
  // Recorded before the manifest goes out, so a worker that dies mid-submission leaves the Job fenced rather than
  // leaving a live Pod invisible to the resource reconcile lane.
  await submitProductJob(request, { identityId, jobClass: intent.jobClass });
  return await runtime.runJob(tenantJobSpec(buildKubeJobSpec(intent, identityId, tenantSecretsKek), scheduling));
}

export async function finalizeRecoveredProductJob(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  intent: ProductJobIntent,
  persisted: WorkerPersistProductJobResultRequest,
  tenantSecretsKek: TenantSecretsKeyring,
  scheduling?: KubeWorkloadScheduling,
): Promise<void> {
  const jobResult: KubeJobResult = await runtime.runJob(
    tenantJobSpec(buildKubeJobSpec(intent, persisted.identityId, tenantSecretsKek), scheduling),
    {
      completedAt: new Date(persisted.completedAt),
      exitCode: persisted.exitCode,
      jobName: persisted.jobName,
      logs: persisted.logs,
      podName: persisted.podName,
      status: persisted.status,
    } satisfies KubePersistedJobResult,
  );
  await jobResult.finalize();
  await finalizeProductJob(request, { identityId: persisted.identityId, jobClass: persisted.jobClass });
}

function createJobResult(
  intent: ProductJobIntent,
  identityId: string,
  jobResult: KubeJobResult,
  tenantSecretsKek: TenantSecretsKeyring,
): WorkerPersistProductJobResultRequest {
  return {
    completedAt: jobResult.completedAt.toISOString(),
    exitCode: jobResult.exitCode,
    identityId,
    jobClass: intent.jobClass,
    jobName: jobResult.jobName,
    logs: redactTenantSecretValues(jobResult.logs, decryptTenantSecretEnvironment(intent.env, tenantSecretsKek)),
    podName: jobResult.podName,
    status: jobResult.status,
  };
}

function buildKubeJobSpec(
  intent: ProductJobIntent,
  identityId: string,
  tenantSecretsKek: TenantSecretsKeyring,
): KubeJobSpec {
  return {
    command: intent.command,
    env: decryptTenantSecretEnvironment(intent.env, tenantSecretsKek),
    id: productJobRuntimeId(intent.jobClass, identityId),
    image: intent.image,
    imagePullSecretId: intent.jobClass === 'release' ? intent.imagePullSecretId : undefined,
    jobClass: intent.jobClass === 'release' ? 'release' : 'operation',
    labels: { 'compartment.dev/job-class': intent.jobClass },
    namespace: intent.namespace,
    securityProfile:
      intent.jobClass === 'release' || intent.runtimeIdentity === 'project'
        ? 'project-restricted'
        : 'resource-restricted',
    serviceAccountName: intent.namespace,
    timeoutMs: intent.timeoutMs,
    volumeMounts: intent.volumeMounts,
  };
}
