import type {
  EnvironmentSummary,
  ProjectSummary,
  ResourceBackupManifest,
  ResourceSummary,
  ResourceVolumeSummary,
} from '@compartment/contracts';
import { createInvalidDeployConfigError } from '../errors/api-business-error';
import type { EnvironmentRow } from '../queries/deployments.query.types';
import type { ProjectRow } from '../queries/projects.query.types';
import type { ResourceBackupRow } from '../queries/resource-backups.query.types';
import type { ProjectResourceRow } from '../queries/resources.query.types';
import type { ResourceBackupArtifactSummary } from './resource-backup-artifact.service';
import type { ResolvedResourceIntent } from './resources.service.helpers';
import {
  parseResourceEnv,
  parseResourcePorts,
  parseResourceReadiness,
  parseResourceRestartPolicy,
  parseResourceVolumes,
  type StoredResourceOperationConfig,
} from './resources.service.storage';
import type { ResourceEnvironmentContext } from './resources.service.types';

export function buildResourceBackupManifest(
  context: ResourceEnvironmentContext,
  resource: ProjectResourceRow,
  backup: ResourceBackupRow,
  intent: ResolvedResourceIntent,
  operation: StoredResourceOperationConfig,
  artifact: ResourceBackupArtifactSummary,
): ResourceBackupManifest {
  return {
    ...buildArtifactManifestFields(artifact),
    backupId: backup.id,
    createdAt: backup.createdAt.toISOString(),
    createdBy: backup.createdByPrincipalId,
    environment: snapshotEnvironmentForManifest(context.environment),
    failureSummary: null,
    operationConfigHash: resource.operationConfigHash,
    operationImage: operation.image ?? resource.image,
    project: snapshotProjectForManifest(context.project),
    resource: snapshotResourceForManifest(resource),
    resourceImage: resource.image,
    resourceRuntimeDefinitionHash: intent.runtimeHash,
    status: 'succeeded',
    volumes: intent.volumes.map(copyResourceVolume),
  };
}

export function assertBackupCanRestoreResource(backup: ResourceBackupRow, resource: ProjectResourceRow): void {
  if (!backupBelongsToResource(backup, resource)) {
    throw createInvalidDeployConfigError(`Backup ${backup.id} cannot be restored to resource ${resource.name}.`);
  }

  assertResourceBackupManifestCompatibility(parseResourceBackupManifest(backup), backup.id, resource);
}

function backupBelongsToResource(backup: ResourceBackupRow, resource: ProjectResourceRow): boolean {
  return backup.projectResourceId === resource.id && backup.status === 'succeeded' && backup.manifestJson !== null;
}

function assertResourceBackupManifestCompatibility(
  manifest: ResourceBackupManifest,
  backupId: string,
  resource: ProjectResourceRow,
): void {
  if (
    manifest.resourceRuntimeDefinitionHash !== resource.runtimeDefinitionHash ||
    manifest.operationConfigHash !== resource.operationConfigHash
  ) {
    throw createInvalidDeployConfigError(`Backup ${backupId} is not compatible with resource ${resource.name}.`);
  }
}

function parseResourceBackupManifest(backup: ResourceBackupRow): ResourceBackupManifest {
  const manifest: ResourceBackupManifest | null = parseResourceBackupManifestJson(backup.manifestJson);
  if (manifest === null) {
    throw createInvalidDeployConfigError(`Backup ${backup.id} does not have a manifest.`);
  }

  return manifest;
}

export function parseResourceBackupManifestJson(manifestJson: string | null): ResourceBackupManifest | null {
  return manifestJson !== null ? (JSON.parse(manifestJson) as ResourceBackupManifest) : null;
}

function buildArtifactManifestFields(
  artifact: ResourceBackupArtifactSummary,
): Pick<ResourceBackupManifest, 'artifactLocation' | 'checksum' | 'size'> {
  return {
    artifactLocation: artifact.location,
    checksum: artifact.checksum,
    size: artifact.sizeBytes,
  };
}

function snapshotProjectForManifest(project: ProjectRow): ProjectSummary {
  const archivedAt: Date | null = project.archivedAt;

  return {
    id: project.id,
    organizationId: project.organizationId,
    name: project.name,
    archivedAt: archivedAt === null ? null : archivedAt.toISOString(),
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

function snapshotEnvironmentForManifest(environment: EnvironmentRow): EnvironmentSummary {
  return {
    id: environment.id,
    projectId: environment.projectId,
    name: environment.name,
    createdAt: environment.createdAt.toISOString(),
    updatedAt: environment.updatedAt.toISOString(),
  };
}

function snapshotResourceForManifest(resource: ProjectResourceRow): ResourceSummary {
  const persistedRuntime: Pick<ResourceSummary, 'containerId' | 'status'> = {
    containerId: resource.containerId,
    status: resource.status,
  };

  return {
    ...persistedRuntime,
    id: resource.id,
    name: resource.name,
    hostname: resource.hostname,
    image: resource.image,
    updatedAt: resource.updatedAt.toISOString(),
    createdAt: resource.createdAt.toISOString(),
    volumes: parseResourceVolumes(resource),
    ports: parseResourcePorts(resource),
    env: parseResourceEnv(resource),
    readiness: parseResourceReadiness(resource),
    restartPolicy: parseResourceRestartPolicy(resource),
  };
}

function copyResourceVolume(volume: ResourceVolumeSummary): ResourceVolumeSummary {
  return { ...volume };
}
