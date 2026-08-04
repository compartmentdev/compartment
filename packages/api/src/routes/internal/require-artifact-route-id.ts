import { hasText } from '@compartment/utils';
import { ApiBoundaryError } from '../../errors/api-boundary-error';

export function requireArtifactRouteId(artifactId: string): string {
  if (!hasText(artifactId)) {
    throw new ApiBoundaryError(400, 'invalid_artifact_id', 'Build artifact id is required.');
  }
  return artifactId;
}
