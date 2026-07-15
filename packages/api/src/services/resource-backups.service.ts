import type { CompartmentResourceOperationScheduleConfig } from '@compartment/contracts';
import { createResourceNotFoundError } from '../errors/api-business-error';
import { listResourceBackups } from '../queries/resource-backups.query';
import type { ResourceBackupRow } from '../queries/resource-backups.query.types';
import {
  findProjectResourceByName,
  lockProjectResourceReferenceByName,
  lockProjectResourceReconciliation,
} from '../queries/resources.query';
import type { ProjectResourceRow, ResourceTransaction } from '../queries/resources.query.types';
import { getApiDatabase } from '../runtime/runtime-access';
import {
  assertResourceDefinesOperation,
  runResourceBackup,
  runResourceRestore,
} from './resource-backups.execution.service';
import { assertResourceBackupBelongsToEnvironment } from './resource-backups.environment.service';
import { resolveRequiredBackupResourceById, resolveRequiredResourceBackup } from './resource-backups.lookup.service';
import { assertBackupCanRestoreResource } from './resource-backup-manifest.service';
import { applyResourceBackupRetention } from './resource-backups.retention.service';
import { isResourceOperationScheduleDue } from './resource-operation-schedule.service';
import { resolveResourceEnvironmentContext } from './resource-environment-context.service';
import { parseStoredResourceOperations } from './resources.service.storage';
import type {
  ResourceActionInput,
  ResourceBackupListResult,
  ResourceBackupRetentionCleanup,
  ResourceBackupResult,
  ResourceBackupShowInput,
  ResourceEnvironmentContext,
  ResourceRestoreInput,
  ResourceRestoreResult,
  ScheduledResourceBackupRunResult,
} from './resources.service.types';

export async function createResourceBackupForPrincipal(input: ResourceActionInput): Promise<ResourceBackupResult> {
  const context: ResourceEnvironmentContext = await resolveResourceEnvironmentContext(input);

  return await runWithResourceOperationLock(
    context,
    input.query.resourceName,
    async (resource: ProjectResourceRow): Promise<ResourceBackupResult> => {
      const result: Pick<ResourceBackupResult, 'backup' | 'manifest'> = await runResourceBackup({
        actorPrincipalId: input.actorPrincipalId,
        context,
        purpose: 'manual',
        resource,
      });

      return { ...context, resource, ...result };
    },
  );
}

export async function listResourceBackupsForPrincipal(input: ResourceActionInput): Promise<ResourceBackupListResult> {
  const context: ResourceEnvironmentContext = await resolveResourceEnvironmentContext(input);
  const resource: ProjectResourceRow = await resolveRequiredResource(context.environment.id, input.query.resourceName);
  const backups: ResourceBackupRow[] = await listResourceBackups(resource.id);

  return { ...context, backups, resource };
}

export async function showResourceBackupForPrincipal(input: ResourceBackupShowInput): Promise<ResourceBackupResult> {
  const context: ResourceEnvironmentContext = await resolveResourceEnvironmentContext(input);
  const backup: ResourceBackupRow = await resolveRequiredResourceBackup(input.query.backupId);
  const resource: ProjectResourceRow = await resolveRequiredBackupResourceById(backup.projectResourceId);
  assertResourceBackupBelongsToEnvironment(resource, context.environment.id);

  return {
    ...context,
    backup,
    manifest: backup.manifestJson,
    resource,
  };
}

export async function restoreResourceBackupForPrincipal(input: ResourceRestoreInput): Promise<ResourceRestoreResult> {
  const context: ResourceEnvironmentContext = await resolveResourceEnvironmentContext(input);

  return await runWithResourceOperationLock(
    context,
    input.query.resourceName,
    async (resource: ProjectResourceRow): Promise<ResourceRestoreResult> => {
      const backup: ResourceBackupRow = await resolveRequiredResourceBackup(input.body.backupId);
      assertBackupCanRestoreResource(backup, resource);
      await assertResourceDefinesOperation(context, resource, 'restore');
      const preRestoreBackup: ResourceBackupRow = (
        await runResourceBackup({
          actorPrincipalId: input.actorPrincipalId,
          context,
          purpose: 'pre_restore',
          resource,
        })
      ).backup;
      await runResourceRestore({ backup, context, resource });

      return { ...context, preRestoreBackup, resource, restoredBackup: backup };
    },
  );
}

export async function runDueScheduledResourceBackup(
  context: ResourceEnvironmentContext,
  resourceName: string,
  now: Date,
): Promise<ScheduledResourceBackupRunResult | null> {
  return await runWithResourceOperationLock(
    context,
    resourceName,
    async (resource: ProjectResourceRow): Promise<ScheduledResourceBackupRunResult | null> =>
      await runDueLockedScheduledResourceBackup(context, resource, now),
  );
}

async function runDueLockedScheduledResourceBackup(
  context: ResourceEnvironmentContext,
  resource: ProjectResourceRow,
  now: Date,
): Promise<ScheduledResourceBackupRunResult | null> {
  const schedule: CompartmentResourceOperationScheduleConfig | null | undefined =
    parseStoredResourceOperations(resource).backup?.schedule;
  if (schedule === null || schedule === undefined || !(await isScheduledResourceBackupDue(resource, schedule, now))) {
    return null;
  }

  const result: Pick<ResourceBackupResult, 'backup' | 'manifest'> = await runResourceBackup({
    actorPrincipalId: null,
    context,
    purpose: 'scheduled',
    resource,
  });
  const cleanedBackups: ResourceBackupRetentionCleanup[] = await applyResourceBackupRetention({
    context,
    now,
    resource,
    retention: schedule.retention,
  });

  return { ...context, cleanedBackups, resource, ...result };
}

async function isScheduledResourceBackupDue(
  resource: ProjectResourceRow,
  schedule: CompartmentResourceOperationScheduleConfig,
  now: Date,
): Promise<boolean> {
  const backups: ResourceBackupRow[] = await listResourceBackups(resource.id);
  const lastScheduledBackup: ResourceBackupRow | null =
    backups.find((backup: ResourceBackupRow): boolean => backup.purpose === 'scheduled') ?? null;

  return isResourceOperationScheduleDue(schedule, lastScheduledBackup, now);
}

async function runWithResourceOperationLock<Result>(
  context: ResourceEnvironmentContext,
  resourceName: string,
  runOperation: (resource: ProjectResourceRow) => Promise<Result>,
): Promise<Result> {
  return await getApiDatabase().transaction(async (tx: ResourceTransaction): Promise<Result> => {
    await lockProjectResourceReconciliation(tx, context.environment.id, resourceName);
    const resource: ProjectResourceRow =
      (await lockProjectResourceReferenceByName(tx, context.environment.id, resourceName)) ?? failResourceLookup();

    return await runOperation(resource);
  });
}

async function resolveRequiredResource(environmentId: string, resourceName: string): Promise<ProjectResourceRow> {
  return (await findProjectResourceByName(environmentId, resourceName)) ?? failResourceLookup();
}

function failResourceLookup(): never {
  throw createResourceNotFoundError();
}
