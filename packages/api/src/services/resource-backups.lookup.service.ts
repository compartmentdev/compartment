import { createResourceBackupNotFoundError, createResourceNotFoundError } from '../errors/api-business-error';
import { findResourceBackupById } from '../queries/resource-backups.query';
import type { ResourceBackupRow } from '../queries/resource-backups.query.types';
import { findProjectResourceById } from '../queries/resources.query';
import type { ProjectResourceRow } from '../queries/resources.query.types';

export async function resolveRequiredResourceBackup(backupId: string): Promise<ResourceBackupRow> {
  return (await findResourceBackupById(backupId)) ?? failBackupLookup();
}

export async function resolveRequiredBackupResourceById(projectResourceId: string): Promise<ProjectResourceRow> {
  return (await findProjectResourceById(projectResourceId)) ?? failResourceLookup();
}

function failBackupLookup(): never {
  throw createResourceBackupNotFoundError();
}

function failResourceLookup(): never {
  throw createResourceNotFoundError();
}
