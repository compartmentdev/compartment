import type { DeploymentReusableImageState } from '@compartment/contracts';
import type { BuildArtifactRow, DeploymentJoinedRow } from '../queries/deployments.query.types';

export function hasReusableDeploymentImage(deployment: Pick<DeploymentJoinedRow, 'artifact'>): boolean {
  return readDeploymentReusableImageState(deployment.artifact) === 'available';
}

export function readDeploymentReusableImageState(
  artifact: Pick<BuildArtifactRow, 'imageRef' | 'imageRetentionState'>,
): DeploymentReusableImageState {
  if (artifact.imageRef === null) {
    return 'missing';
  }

  return artifact.imageRetentionState;
}
