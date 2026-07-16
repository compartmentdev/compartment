import type {
  ResourceListResponse,
  ResourceLogLine,
  ResourceLogsResponse,
  ResourceOutputListResponse,
  ResourceOutputResponse,
  ResourceOutputSummary,
  ResourceBackupCreateResponse,
  ResourceBackupListResponse,
  ResourceBackupShowResponse,
  ResourceBackupSummary,
  ResourceResponse,
  ResourceRestoreAsResponse,
  ResourceRestoreResponse,
  ResourceSummary,
  ResourceDeleteResponse,
} from '@compartment/contracts';

export function createResourceListMessage(response: ResourceListResponse): string {
  if (response.resources.length === 0) {
    return `No resources found for ${response.project.name}/${response.environment.name}.`;
  }

  return response.resources
    .map((resource: ResourceSummary): string => `${resource.name}\t${resource.status}`)
    .join('\n');
}

export function createResourceResponseMessage(response: ResourceResponse): string {
  const resource: ResourceSummary = response.resource;
  const portsText: string = resource.ports.length > 0 ? resource.ports.join(', ') : 'none';

  return `${resource.name} ${resource.status}
image: ${resource.image}
ports: ${portsText}`;
}

export function createResourceLogsMessage(response: ResourceLogsResponse): string {
  return response.lines.map((line: ResourceLogLine): string => line.message).join('\n');
}

export function createResourceOutputListMessage(response: ResourceOutputListResponse): string {
  if (response.outputs.length === 0) {
    return `No outputs found for resource ${response.resource.name}.`;
  }

  return response.outputs.map(formatResourceOutputLine).join('\n');
}

export function createResourceOutputShowMessage(response: ResourceOutputResponse): string {
  return formatResourceOutputLine(response.output);
}

export function createResourceDeleteMessage(response: ResourceDeleteResponse): string {
  if (response.retainedVolumes.length === 0) {
    return 'Resource deleted.';
  }

  return `Resource deleted. Retained volumes: ${response.retainedVolumes.join(', ')}.`;
}

export function createResourceBackupCreateMessage(response: ResourceBackupCreateResponse): string {
  return `Backup ${response.backup.id} ${response.backup.status} for resource ${response.backup.resource.name}.`;
}

export function createResourceBackupListMessage(response: ResourceBackupListResponse): string {
  if (response.backups.length === 0) {
    return formatResourceBackupScheduleLine(response) ?? `No backups found for resource ${response.resource.name}.`;
  }

  return [formatResourceBackupScheduleLine(response), ...response.backups.map(formatResourceBackupLine)]
    .filter((line: string | null): line is string => line !== null)
    .join('\n');
}

export function createResourceBackupShowMessage(response: ResourceBackupShowResponse): string {
  return formatResourceBackupLine(response.backup);
}

export function createResourceRestoreMessage(response: ResourceRestoreResponse | ResourceRestoreAsResponse): string {
  if (!('preRestoreBackup' in response)) {
    return `Resource ${response.resource.name} restored from backup ${response.restoredBackup.id}.`;
  }

  return `Resource ${response.resource.name} restored from backup ${response.restoredBackup.id}. Pre-restore backup: ${response.preRestoreBackup.id}.`;
}

function formatResourceBackupLine(backup: ResourceBackupSummary): string {
  const cleanupText: string =
    backup.retentionDeletedAt !== null ? `\tcleaned ${backup.retentionDeletedAt} (${backup.retentionReason})` : '';

  return `${backup.id}\t${backup.status}\t${backup.purpose}\t${backup.createdAt}${cleanupText}`;
}

function formatResourceOutputLine(output: ResourceOutputSummary): string {
  const value: string = output.valueHidden ? '<hidden>' : (output.value ?? '');

  return `${output.name}\t${output.sensitivity}\t${value}`;
}

function formatResourceBackupScheduleLine(response: ResourceBackupListResponse): string | null {
  if (response.scheduledOperation === null) {
    return null;
  }

  const scheduleText: string =
    response.scheduledOperation.schedule.interval ?? `cron ${response.scheduledOperation.schedule.cron}`;
  const lastRunText: string = response.scheduledOperation.lastRunAt ?? 'never';

  return `scheduled backup\t${scheduleText}\tlast run ${lastRunText}\tcleaned ${response.scheduledOperation.cleanedCount}`;
}
