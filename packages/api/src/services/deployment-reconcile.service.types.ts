import type { DeploymentArtifactCleanupTarget } from '@compartment/contracts';

export interface DeploymentReconcileObservationResult {
  applied: boolean;
  cleanupArtifacts: DeploymentArtifactCleanupTarget[];
}
