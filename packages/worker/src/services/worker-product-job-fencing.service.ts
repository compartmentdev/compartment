import type { ProductJobIntent, ProductJobVolumeMount, ResourceClaimIdentity } from '@compartment/contracts';
import {
  assertResourceClaimOwnership,
  type KubeManifest,
  type KubeRuntime,
  type ObservedResourceClaim,
} from '@compartment/kube-runtime';
import type { CompartmentRequester } from '@compartment/sdk';
import { persistProductJobFailure } from './worker-product-job-failure.service';
import { readLiveResourceClaims } from './worker-resource-claim-observation.service';

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
  const observedClaims: ObservedResourceClaim[] = await readLiveResourceClaims(
    runtime,
    volumeMounts.map((mount: ProductJobVolumeMount): KubeManifest => mountedClaimIdentity(mount, intent.namespace)),
  );
  try {
    assertProductJobClaims(volumeMounts, observedClaims);
  } catch (error) {
    const failure: Error = error instanceof Error ? error : new Error('Product Job fencing failed.');
    await persistProductJobFailure(request, intent, 'fencing-violation', failure);
    throw failure;
  }
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

function mountedClaimIdentity(mount: ProductJobVolumeMount, namespace: string): KubeManifest {
  return {
    apiVersion: 'v1',
    kind: 'PersistentVolumeClaim',
    metadata: { name: mount.claimName, namespace },
  };
}
