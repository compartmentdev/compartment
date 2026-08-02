import {
  buildCompartmentArtifactImageRepository,
  retargetCompartmentArtifactImageDigestRef,
  type DeploymentReconcileProjection,
  type DeploymentReconcileTarget,
} from '@compartment/contracts';
import type { WorkerArtifactRegistryConfig } from './worker-artifact-registry.types';

export function readWorkerArtifactRegistryInternalHost(artifactRegistry: WorkerArtifactRegistryConfig): string {
  return artifactRegistry.internalAddress;
}

export function retargetWorkerDeploymentArtifactImages(
  target: DeploymentReconcileTarget,
  artifactRegistry: WorkerArtifactRegistryConfig,
): DeploymentReconcileTarget {
  return {
    ...target,
    active: target.active === null ? null : retargetProjectionImage(target.active, artifactRegistry),
    candidate: retargetProjectionImage(target.candidate, artifactRegistry),
  };
}

function retargetProjectionImage(
  projection: DeploymentReconcileProjection,
  artifactRegistry: WorkerArtifactRegistryConfig,
): DeploymentReconcileProjection {
  const imageRepository: string = buildCompartmentArtifactImageRepository(projection.projectId, projection.serviceId);
  const image: string | null = retargetCompartmentArtifactImageDigestRef(
    artifactRegistry.address,
    imageRepository,
    projection.image,
  );
  if (image === null) {
    throw new Error(`Deployment ${projection.deploymentId} has an invalid artifact image reference.`);
  }
  return { ...projection, image };
}
