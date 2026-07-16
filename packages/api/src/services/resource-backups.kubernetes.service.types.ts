import type { ResourceBackupRow } from '../queries/resource-backups.query.types';
import type { ProjectResourceRow } from '../queries/resources.query.types';
import type {
  ResourceBackupOperationContext,
  ResourceOperationKind,
} from './resource-backups.operation-context.service';
import type { ResourceEnvironmentContext } from './resources.service.types';

export interface KubernetesVerifiedRestoreInput {
  artifactResource: ProjectResourceRow;
  backup: ResourceBackupRow;
  context: ResourceEnvironmentContext;
  operationContext: ResourceBackupOperationContext;
  operationId: string;
  resource: ProjectResourceRow;
}

export interface KubernetesResourceOperationInput {
  backupId: string;
  context: ResourceEnvironmentContext;
  operationContext: ResourceBackupOperationContext;
  operationId: string;
  operationKind: ResourceOperationKind;
  resource: ProjectResourceRow;
  volumeResource?: ProjectResourceRow | undefined;
}

export interface KubernetesBackupArtifactDeleteInput {
  backup: ResourceBackupRow;
  context: ResourceEnvironmentContext;
  resource: ProjectResourceRow;
}

export interface KubernetesArtifactMetadata {
  checksum: string;
  sizeBytes: number;
}
