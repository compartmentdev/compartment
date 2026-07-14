import { createInvalidDeployConfigError } from '../errors/api-business-error';
import type { ResourceBackupRow } from '../queries/resource-backups.query.types';
import type { KubernetesArtifactMetadata } from './resource-backups.kubernetes.service';

export function assertKubernetesArtifactLocation(backup: ResourceBackupRow): void {
  if (backup.artifactLocation !== kubeBackupArtifactLocation(backup.id)) {
    throw createInvalidDeployConfigError(`Backup ${backup.id} does not have a Kubernetes backup artifact.`);
  }
}

export function assertKubernetesRestoreArtifactIntegrity(
  backup: ResourceBackupRow,
  metadata: KubernetesArtifactMetadata,
): void {
  if (backup.checksum === null || backup.sizeBytes === null) {
    throw createInvalidDeployConfigError(`Backup ${backup.id} does not have integrity metadata.`);
  }
  if (metadata.checksum !== backup.checksum || metadata.sizeBytes !== backup.sizeBytes) {
    throw createInvalidDeployConfigError(`Backup ${backup.id} artifact integrity verification failed.`);
  }
}

export function kubeBackupArtifactLocation(backupId: string): string {
  return `pvc://${backupId}`;
}
