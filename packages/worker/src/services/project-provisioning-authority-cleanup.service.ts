import type { ProjectProvisioningTargetV2 } from '@compartment/contracts';
import {
  projectProvisioningAuthorityCleanup,
  type KubeManifest,
  type KubeRuntime,
  type ProjectProvisioningAuthorityInput,
} from '@compartment/kube-runtime';
import type { CompartmentRequester } from '@compartment/sdk';
import type { Logger } from 'pino';
import type { ProjectProvisioningCleanupObservation } from './project-provisioning-execution.service.types';
import { assertProjectProvisioningLease } from './project-provisioning-lease.service';

export async function cleanupProjectProvisioningAuthority(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  authority: ProjectProvisioningAuthorityInput,
  target: ProjectProvisioningTargetV2,
  logger: Logger,
): Promise<KubeManifest[]> {
  try {
    const cleanup: KubeManifest[] = await readProjectProvisioningCleanup(runtime, authority);
    await assertProjectProvisioningLease(request, target);
    await runtime.apply({ deleteAfterApply: cleanup, objects: [] });
    return cleanup;
  } catch (error) {
    logger.warn({ err: error }, 'Project provisioning authority cleanup failed.');
    throw error;
  }
}

async function readProjectProvisioningCleanup(
  runtime: KubeRuntime,
  authority: ProjectProvisioningAuthorityInput,
): Promise<KubeManifest[]> {
  const cleanup: KubeManifest[] = projectProvisioningAuthorityCleanup(authority).deleteAfterApply ?? [];
  const observed: ProjectProvisioningCleanupObservation[] = await Promise.all(
    cleanup.map(
      async (desired: KubeManifest): Promise<ProjectProvisioningCleanupObservation> => ({
        desired,
        live: await runtime.read(desired),
      }),
    ),
  );
  return observed
    .filter(isOwnedCleanupManifest)
    .map(
      (observation: ProjectProvisioningCleanupObservation & { live: KubeManifest }): KubeManifest => observation.live,
    );
}

function isOwnedCleanupManifest(
  candidate: ProjectProvisioningCleanupObservation,
): candidate is ProjectProvisioningCleanupObservation & { live: KubeManifest } {
  if (candidate.live === null || candidate.live.kind === 'Pod') {
    return false;
  }
  if (candidate.desired.kind !== 'ClusterRoleBinding') {
    return true;
  }
  return (
    JSON.stringify(candidate.live.roleRef) === JSON.stringify(candidate.desired.roleRef) &&
    JSON.stringify(candidate.live.subjects) === JSON.stringify(candidate.desired.subjects)
  );
}
