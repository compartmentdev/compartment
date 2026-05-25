import type { ResourceVolumeSummary } from '@compartment/contracts';
import { createInvalidDeployConfigError } from '../errors/api-business-error';
import type { ProjectResourceRow } from '../queries/resources.query.types';
import type { ResolvedResourceIntent } from './resources.service.helpers';
import { parseResourceVolumes } from './resources.service.storage';

export function assertAllowedVolumeChange(existingResource: ProjectResourceRow, intent: ResolvedResourceIntent): void {
  const existingVolumes: Map<string, ResourceVolumeSummary> = new Map<string, ResourceVolumeSummary>(
    parseResourceVolumes(existingResource).map((volume: ResourceVolumeSummary): [string, ResourceVolumeSummary] => [
      volume.name,
      volume,
    ]),
  );
  const nextVolumes: Map<string, ResourceVolumeSummary> = new Map<string, ResourceVolumeSummary>(
    intent.volumes.map((volume: ResourceVolumeSummary): [string, ResourceVolumeSummary] => [volume.name, volume]),
  );

  for (const [name, existingVolume] of existingVolumes) {
    const nextVolume: ResourceVolumeSummary | undefined = nextVolumes.get(name);
    if (nextVolume === undefined) {
      throw createInvalidDeployConfigError(`Resource volume ${name} cannot be removed during deploy.`);
    }
    if (nextVolume.mountPath !== existingVolume.mountPath) {
      throw createInvalidDeployConfigError(`Resource volume ${name} mount path cannot be changed during deploy.`);
    }
  }
}
