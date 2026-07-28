import type { WorkerArtifactRegistryConfig } from './worker-artifact-registry.types';

export function readWorkerArtifactRegistryInternalHost(artifactRegistry: WorkerArtifactRegistryConfig): string {
  return artifactRegistry.internalAddress;
}
