import type {
  ProductJobIntent,
  ProductJobResourceReadiness,
  ProductJobVolumeMount,
  ResourceClaimIdentity,
  WorkerPersistProductJobResultRequest,
} from '@compartment/contracts';
import {
  assertResourceClaimOwnership,
  type KubeManifest,
  type KubeObservedManifest,
  type KubeRuntime,
  type ObservedResourceClaim,
} from '@compartment/kube-runtime';
import { persistProductJobResult, type CompartmentRequester } from '@compartment/sdk';
import { readExpiredProductJobResources, readUnreadyProductJobResources } from './worker-product-job-readiness.service';
import type { ObservedClaimPhase } from './worker-product-job-fencing.service.types';

const syntheticProductJobFailurePrefix: Record<SyntheticProductJobFailureReason, string> = {
  'fencing-violation': 'failed-before-result',
  'resource-not-ready': 'resource-not-ready',
};

type SyntheticProductJobFailureReason = 'fencing-violation' | 'resource-not-ready';

/**
 * Decides whether a claimed Job may be handed to Kubernetes now. A Job that dials a resource which is
 * not accepting connections is left claimable so the controller can move on and reconcile that resource;
 * it only becomes a durable failure once the resource has missed the readiness deadline it declared.
 */
export async function admitProductJobResources(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  intent: ProductJobIntent,
  resourceReadiness: readonly ProductJobResourceReadiness[],
): Promise<boolean> {
  if (resourceReadiness.length === 0) {
    return true;
  }
  const unready: ProductJobResourceReadiness[] = await readUnreadyProductJobResources(
    runtime,
    intent.namespace,
    resourceReadiness,
  );
  if (unready.length === 0) {
    return true;
  }
  const expired: ProductJobResourceReadiness[] = readExpiredProductJobResources(unready, new Date());
  if (expired.length === 0) {
    return false;
  }
  await persistProductJobFailure(request, intent, 'resource-not-ready', new Error(expiredResourceMessage(expired)));
  return false;
}

function expiredResourceMessage(expired: readonly ProductJobResourceReadiness[]): string {
  const names: string = expired.map((resource: ProductJobResourceReadiness): string => resource.resourceId).join(', ');
  return `The Job was not created: connected resources stayed unready past their declared readiness timeout: ${names}.`;
}

/** Proves the mounted claims are still the ones this operation was planned against. */
export async function fenceProductJobClaims(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  intent: ProductJobIntent,
): Promise<void> {
  const volumeMounts: readonly ProductJobVolumeMount[] = intent.volumeMounts ?? [];
  if (volumeMounts.length === 0) {
    return;
  }
  const observedClaims: ObservedResourceClaim[] = await readMountedClaims(runtime, intent.namespace, volumeMounts);
  try {
    assertProductJobClaims(volumeMounts, observedClaims);
  } catch (error) {
    const failure: Error = error instanceof Error ? error : new Error('Product Job fencing failed.');
    await persistProductJobFailure(request, intent, 'fencing-violation', failure);
    throw failure;
  }
}

export function readProductJobIdentity(intent: ProductJobIntent): string {
  return intent.jobClass === 'release' ? intent.deploymentId : intent.operationId;
}

async function persistProductJobFailure(
  request: CompartmentRequester,
  intent: ProductJobIntent,
  reason: SyntheticProductJobFailureReason,
  failure: Error,
): Promise<void> {
  const identityId: string = readProductJobIdentity(intent);
  await persistProductJobResult(request, {
    completedAt: new Date().toISOString(),
    exitCode: null,
    identityId,
    jobClass: intent.jobClass,
    jobName: `${syntheticProductJobFailurePrefix[reason]}/${identityId}`,
    logs: failure.message,
    podName: null,
    status: 'timed-out',
  } satisfies WorkerPersistProductJobResultRequest);
}

function assertProductJobClaims(
  volumeMounts: readonly ProductJobVolumeMount[],
  observedClaims: ObservedResourceClaim[],
): void {
  assertResourceClaimOwnership(
    volumeMounts.map(
      (mount: ProductJobVolumeMount): ResourceClaimIdentity => ({
        claimName: mount.claimName,
        uid: mount.expectedClaimUid,
      }),
    ),
    observedClaims,
  );
}

async function readMountedClaims(
  runtime: KubeRuntime,
  namespace: string,
  volumeMounts: readonly ProductJobVolumeMount[],
): Promise<ObservedResourceClaim[]> {
  return await Promise.all(
    volumeMounts.map(async (mount: ProductJobVolumeMount): Promise<ObservedResourceClaim> => {
      const claim: KubeManifest = {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name: mount.claimName, namespace },
      };
      const observed: KubeObservedManifest | null = await runtime.read(claim);
      return {
        bound: (observed?.status as ObservedClaimPhase | undefined)?.phase === 'Bound',
        claimName: mount.claimName,
        resourceVersion: observed?.metadata?.resourceVersion ?? null,
        uid: observed?.metadata?.uid ?? null,
      };
    }),
  );
}
