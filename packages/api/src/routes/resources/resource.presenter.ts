import type {
  ResourceDeleteResponse,
  ResourceBackupCreateResponse,
  ResourceBackupListResponse,
  ResourceBackupShowResponse,
  ResourceBackupScheduledOperationSummary,
  ResourceBackupSummary,
  ResourceRestoreResponse,
  ResourceRestoreAsResponse,
  ResourceListResponse,
  ResourceLogsResponse,
  ResourceOutputListResponse,
  ResourceOutputResponse,
  ResourceOutputSummary,
  ResourceResponse,
  CompartmentResourceOperationScheduleConfig,
} from '@compartment/contracts';
import type {
  ResourceListResponseInput,
  ResourceBackupListResponseInput,
  ResourceBackupResponseInput,
  ResourceBackupSummaryInput,
  ResourceRestoreResponseInput,
  ResourceRestoreAsResponseInput,
  ResourceLogsResult,
  ResourceOutputListResponseInput,
  ResourceOutputResponseInput,
  ResourceOutputSummaryInput,
  ResourceResponseInput,
  ResourceSummaryInput,
} from '../../services/resources.service.types';
import { parseResourceBackupManifestJson } from '../../services/resource-backup-manifest.service';
import { parseStoredResourceOperations } from '../../services/resources.service.storage';
import { toNullableIsoString } from '../presenters/date.presenter';
import { buildEnvironmentSummary } from '../presenters/environment-summary.presenter';
import { buildProjectSummary } from '../presenters/project-summary.presenter';
import { buildResourceSummary } from '../presenters/resource-summary.presenter';

export function buildResourceListResponse(input: ResourceListResponseInput): ResourceListResponse {
  return {
    environment: buildEnvironmentSummary(input.environment),
    project: buildProjectSummary(input.project),
    resources: input.resources.map(buildResourceSummary),
  };
}

export function buildResourceLogsResponse(input: ResourceLogsResult): ResourceLogsResponse {
  return {
    ...buildResourceResponse(input),
    lines: input.lines,
  };
}

export function buildResourceOutputListResponse(input: ResourceOutputListResponseInput): ResourceOutputListResponse {
  return {
    ...buildResourceResponse(input),
    outputs: input.outputs.map(buildResourceOutputSummary),
  };
}

export function buildResourceOutputResponse(input: ResourceOutputResponseInput): ResourceOutputResponse {
  return {
    ...buildResourceResponse(input),
    output: buildResourceOutputSummary(input.output),
  };
}

export function buildResourceResponse(input: ResourceResponseInput): ResourceResponse {
  return {
    environment: buildEnvironmentSummary(input.environment),
    project: buildProjectSummary(input.project),
    resource: buildResourceSummary(input.resource),
  };
}

function buildResourceOutputSummary(input: ResourceOutputSummaryInput): ResourceOutputSummary {
  return {
    name: input.name,
    sensitivity: input.sensitivity,
    value: input.value,
    valueFingerprint: input.valueFingerprint,
    valueHidden: input.valueHidden,
  };
}

export function buildResourceDeleteResponse(retainedVolumes: string[]): ResourceDeleteResponse {
  return {
    retainedVolumes,
    success: true,
  };
}

export function buildResourceBackupCreateResponse(input: ResourceBackupResponseInput): ResourceBackupCreateResponse {
  return {
    backup: buildResourceBackupSummary(input.backup, input.resource),
    environment: buildEnvironmentSummary(input.environment),
    project: buildProjectSummary(input.project),
  };
}

export function buildResourceBackupListResponse(input: ResourceBackupListResponseInput): ResourceBackupListResponse {
  return {
    backups: input.backups.map(
      (backup: ResourceBackupSummaryInput): ResourceBackupSummary => buildResourceBackupSummary(backup, input.resource),
    ),
    environment: buildEnvironmentSummary(input.environment),
    project: buildProjectSummary(input.project),
    resource: buildResourceSummary(input.resource),
    scheduledOperation: buildResourceBackupScheduledOperationSummary(input),
  };
}

export function buildResourceBackupShowResponse(input: ResourceBackupResponseInput): ResourceBackupShowResponse {
  return {
    backup: buildResourceBackupSummary(input.backup, input.resource),
    environment: buildEnvironmentSummary(input.environment),
    manifest: parseResourceBackupManifestJson(input.manifest),
    project: buildProjectSummary(input.project),
  };
}

export function buildResourceRestoreResponse(input: ResourceRestoreResponseInput): ResourceRestoreResponse {
  return {
    environment: buildEnvironmentSummary(input.environment),
    preRestoreBackup: buildResourceBackupSummary(input.preRestoreBackup, input.resource),
    project: buildProjectSummary(input.project),
    resource: buildResourceSummary(input.resource),
    restoredBackup: buildResourceBackupSummary(input.restoredBackup, input.resource),
    success: true,
  };
}

export function buildResourceRestoreAsResponse(input: ResourceRestoreAsResponseInput): ResourceRestoreAsResponse {
  return {
    environment: buildEnvironmentSummary(input.environment),
    project: buildProjectSummary(input.project),
    resource: buildResourceSummary(input.resource),
    restoredBackup: buildResourceBackupSummary(input.restoredBackup, input.sourceResource),
    success: true,
  };
}

function buildResourceBackupSummary(
  backup: ResourceBackupSummaryInput,
  resource: ResourceSummaryInput,
): ResourceBackupSummary {
  return {
    artifactLocation: backup.artifactLocation,
    checksum: backup.checksum,
    completedAt: toNullableIsoString(backup.completedAt),
    createdAt: backup.createdAt.toISOString(),
    failureSummary: backup.failureSummary,
    id: backup.id,
    purpose: backup.purpose,
    retentionDeletedAt: toNullableIsoString(backup.retentionDeletedAt),
    retentionReason: backup.retentionReason,
    resource: buildResourceSummary(resource),
    size: backup.sizeBytes,
    status: backup.status,
  };
}

function buildResourceBackupScheduledOperationSummary(
  input: ResourceBackupListResponseInput,
): ResourceBackupScheduledOperationSummary | null {
  const schedule: CompartmentResourceOperationScheduleConfig | null | undefined = parseStoredResourceOperations(
    input.resource,
  ).backup?.schedule;
  if (schedule === null || schedule === undefined) {
    return null;
  }

  const latestScheduledBackup: ResourceBackupSummaryInput | undefined = input.backups.find(
    (backup: ResourceBackupSummaryInput): boolean => backup.purpose === 'scheduled',
  );
  const lastCleanupAt: Date | null = findLatestRetentionDeletedAt(input.backups);

  return {
    cleanedCount: countCleanedBackups(input.backups),
    lastCleanupAt: toNullableIsoString(lastCleanupAt),
    lastRunAt: toNullableIsoString(latestScheduledBackup?.createdAt ?? null),
    lastStatus: latestScheduledBackup?.status ?? null,
    retention: schedule.retention ?? null,
    schedule,
  };
}

function countCleanedBackups(backups: ResourceBackupSummaryInput[]): number {
  return backups.filter((backup: ResourceBackupSummaryInput): boolean => backup.retentionDeletedAt !== null).length;
}

function findLatestRetentionDeletedAt(backups: ResourceBackupSummaryInput[]): Date | null {
  return backups.reduce<Date | null>(
    (latest: Date | null, backup: ResourceBackupSummaryInput): Date | null =>
      backup.retentionDeletedAt !== null && (latest === null || backup.retentionDeletedAt > latest)
        ? backup.retentionDeletedAt
        : latest,
    null,
  );
}
