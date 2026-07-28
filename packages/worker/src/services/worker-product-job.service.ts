import {
  productJobRuntimeId,
  type ProductJobIntent,
  type ProductJobClass,
  type ProductJobVolumeMount,
  type ResourceClaimIdentity,
  type WorkerPersistProductJobResultRequest,
  type WorkerPersistProductJobIntentResponse,
} from '@compartment/contracts';
import {
  assertResourceClaimOwnership,
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

enum SyntheticProductJobFailureReason {
  FencingViolation = 'fencing-violation',
}

interface SyntheticProductJobFailureClassification {
  jobNamePrefix: string;
  status: 'timed-out';
}

const syntheticProductJobFailureByReason: Record<
  SyntheticProductJobFailureReason,
  SyntheticProductJobFailureClassification
> = {
  [SyntheticProductJobFailureReason.FencingViolation]: {
    jobNamePrefix: 'failed-before-result',
    status: 'timed-out',
  },
};

export async function executeProductJob(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  intent: ProductJobIntent,
): Promise<WorkerPersistProductJobResultRequest> {
  const persisted: WorkerPersistProductJobIntentResponse = await persistProductJobIntent(request, intent);
  const identityId: string = readProductJobIdentity(intent);
  if (persisted.result !== null) {
    throwProductJobFailure(persisted.result);
  }
  const jobResult: KubeJobResult = await runProductJobWithDurableFailure(request, runtime, intent, identityId);
  const result: WorkerPersistProductJobResultRequest = buildProductJobResult(intent, identityId, jobResult);
  await persistProductJobResult(request, result);
  await jobResult.finalize();
  await finalizeProductJob(request, { identityId, jobClass: intent.jobClass });
  if (result.status !== 'succeeded') {
    throwProductJobFailure(result);
  }
  return result;
}

function throwProductJobFailure(result: WorkerPersistProductJobResultRequest): never {
  if (result.status === 'succeeded') {
    throw new Error(`Product ${result.jobClass} job ${result.identityId} was already completed.`);
  }
  throw new ProductJobFailedError(result.jobClass, result.identityId, result.status);
}

async function runProductJobWithDurableFailure(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  intent: ProductJobIntent,
  identityId: string,
): Promise<KubeJobResult> {
  if (intent.volumeMounts !== undefined && intent.volumeMounts.length > 0) {
    const observedClaims: ObservedResourceClaim[] = await readMountedClaims(runtime, intent);
    try {
      assertProductJobClaims(intent, observedClaims);
    } catch (error) {
      const failure: Error = error instanceof Error ? error : new Error('Product Job fencing failed.');
      await persistProductJobFencingFailure(request, intent, identityId, failure);
    }
  }
  return await runtime.runJob(buildKubeJobSpec(intent, identityId));
}

async function persistProductJobFencingFailure(
  request: CompartmentRequester,
  intent: ProductJobIntent,
  identityId: string,
  failure: Error,
): Promise<never> {
  await persistProductJobResult(
    request,
    buildSyntheticProductJobFailure(intent, identityId, SyntheticProductJobFailureReason.FencingViolation, failure),
  );
  throw failure;
}

function assertProductJobClaims(intent: ProductJobIntent, observedClaims: ObservedResourceClaim[]): void {
  assertResourceClaimOwnership(
    (intent.volumeMounts ?? []).map(
      (mount: ProductJobVolumeMount): ResourceClaimIdentity => ({
        claimName: mount.claimName,
        uid: mount.expectedClaimUid,
      }),
    ),
    observedClaims,
  );
}

function buildSyntheticProductJobFailure(
  intent: ProductJobIntent,
  identityId: string,
  reason: SyntheticProductJobFailureReason,
  failure: Error,
): WorkerPersistProductJobResultRequest {
  const classification: SyntheticProductJobFailureClassification = syntheticProductJobFailureByReason[reason];
  return {
    completedAt: new Date().toISOString(),
    exitCode: null,
    identityId,
    jobClass: intent.jobClass,
    jobName: `${classification.jobNamePrefix}/${identityId}`,
    logs: failure.message,
    podName: null,
    status: classification.status,
  };
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
        resourceVersion: observed?.metadata?.resourceVersion ?? null,
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

function readProductJobIdentity(intent: ProductJobIntent): string {
  return intent.jobClass === 'release' ? intent.deploymentId : intent.operationId;
}
