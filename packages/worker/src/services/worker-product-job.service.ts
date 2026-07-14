import type {
  ProductJobIntent,
  ProductJobClass,
  ProductJobVolumeMount,
  ResourceClaimIdentity,
  WorkerPersistProductJobResultRequest,
} from '@compartment/contracts';
import {
  assertResourceClaimIdentity,
  type KubeJobResult,
  type KubeJobSpec,
  type KubeManifest,
  type KubeObservedManifest,
  type KubePersistedJobResult,
  type KubeRuntime,
  type ObservedResourceClaim,
} from '@compartment/kube-runtime';
import {
  finalizeProductJob,
  persistProductJobIntent,
  persistProductJobResult,
  type CompartmentRequester,
} from '@compartment/sdk';

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
): Promise<WorkerPersistProductJobResultRequest> {
  await persistProductJobIntent(request, intent);
  const identityId: string = readProductJobIdentity(intent);
  await assertProductJobClaims(runtime, intent);
  const jobResult: KubeJobResult = await runtime.runJob(buildKubeJobSpec(intent, identityId));
  const result: WorkerPersistProductJobResultRequest = buildProductJobResult(intent, identityId, jobResult);
  await persistProductJobResult(request, result);
  await jobResult.finalize();
  await finalizeProductJob(request, { identityId, jobClass: intent.jobClass });
  if (result.status !== 'succeeded') {
    throw new ProductJobFailedError(intent.jobClass, identityId, result.status);
  }
  return result;
}

async function assertProductJobClaims(runtime: KubeRuntime, intent: ProductJobIntent): Promise<void> {
  if (intent.volumeMounts === undefined || intent.volumeMounts.length === 0) {
    return;
  }
  assertResourceClaimIdentity(
    intent.volumeMounts.map(
      (mount: ProductJobVolumeMount): ResourceClaimIdentity => ({
        claimName: mount.claimName,
        uid: mount.expectedClaimUid,
      }),
    ),
    await readMountedClaims(runtime, intent),
  );
}

async function readMountedClaims(runtime: KubeRuntime, intent: ProductJobIntent): Promise<ObservedResourceClaim[]> {
  return await Promise.all(
    (intent.volumeMounts ?? []).map(async (mount: ProductJobVolumeMount): Promise<ObservedResourceClaim> => {
      const claim: KubeManifest = {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name: mount.claimName, namespace: intent.namespace },
      };
      const observed: KubeObservedManifest | null = await runtime.read(claim);
      return {
        bound: (observed?.status as { phase?: string | undefined } | undefined)?.phase === 'Bound',
        claimName: mount.claimName,
        uid: observed?.metadata?.uid ?? null,
      };
    }),
  );
}

export async function finalizeRecoveredProductJob(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  intent: ProductJobIntent,
  persisted: WorkerPersistProductJobResultRequest,
): Promise<void> {
  const jobResult: KubeJobResult = await runtime.runJob(buildKubeJobSpec(intent, persisted.identityId), {
    completedAt: new Date(persisted.completedAt),
    exitCode: persisted.exitCode,
    jobName: persisted.jobName,
    logs: persisted.logs,
    podName: persisted.podName,
    status: persisted.status,
  } satisfies KubePersistedJobResult);
  await jobResult.finalize();
  await finalizeProductJob(request, { identityId: persisted.identityId, jobClass: persisted.jobClass });
}

function buildProductJobResult(
  intent: ProductJobIntent,
  identityId: string,
  jobResult: KubeJobResult,
): WorkerPersistProductJobResultRequest {
  return {
    completedAt: jobResult.completedAt.toISOString(),
    exitCode: jobResult.exitCode,
    identityId,
    jobClass: intent.jobClass,
    jobName: jobResult.jobName,
    logs: jobResult.logs,
    podName: jobResult.podName,
    status: jobResult.status,
  };
}

function buildKubeJobSpec(intent: ProductJobIntent, identityId: string): KubeJobSpec {
  return {
    command: intent.command,
    env: intent.env,
    id: `${intent.jobClass}-${identityId}`,
    image: intent.image,
    jobClass: intent.jobClass === 'release' ? 'release' : 'operation',
    labels: { 'compartment.dev/job-class': intent.jobClass },
    namespace: intent.namespace,
    timeoutMs: intent.timeoutMs,
    volumeMounts: intent.volumeMounts,
  };
}

function readProductJobIdentity(intent: ProductJobIntent): string {
  return intent.jobClass === 'release' ? intent.deploymentId : intent.operationId;
}
