import type { CompartmentResourceOperationScheduleConfig } from '@compartment/contracts';
import { createProjectArchivedError, createResourceNotFoundError } from '../errors/api-business-error';
import { listResourceBackups } from '../queries/resource-backups.query';
import type { ResourceBackupRow } from '../queries/resource-backups.query.types';
import {
  findProjectResourceByName,
  lockProjectResourceOperation,
  lockProjectResourceReferenceByName,
} from '../queries/resources.query';
import type { ProjectResourceRow, ResourceTransaction } from '../queries/resources.query.types';
import { getApiDatabase } from '../runtime/runtime-access';
import {
  assertResourceDefinesOperation,
  runResourceBackup,
  runResourceRestore,
} from './resource-backups.execution.service';
import { assertResourceRunningForManualBackup } from './resource-backups.manual.service';
import { assertResourceBackupBelongsToEnvironment } from './resource-backups.environment.service';
import { resolveRequiredBackupResourceById, resolveRequiredResourceBackup } from './resource-backups.lookup.service';
import { assertBackupCanRestoreResource } from './resource-backup-manifest.service';
import { applyResourceBackupRetention } from './resource-backups.retention.service';
import { isResourceOperationScheduleDue } from './resource-operation-schedule.service';
import { withResourceOperationLocks } from './resource-operation-lock.service';
import { waitForResourceClaimIdentities } from './resource-reconcile-run.service';
import { resolveResourceEnvironmentContext } from './resource-environment-context.service';
import { parseStoredResourceOperations } from './resources.service.storage';
import type { LockedResourceOperationResult } from './resource-backups.service.types';
import type {
  ResourceActionInput,
  ResourceBackupListResult,
  ResourceBackupRetentionResult,
  ResourceBackupResult,
  ResourceBackupShowInput,
  ResourceEnvironmentContext,
  ResourceRestoreInput,
  ResourceRestoreResult,
  ScheduledResourceBackupRunResult,
} from './resources.service.types';

export async function createResourceBackupForPrincipal(input: ResourceActionInput): Promise<ResourceBackupResult> {
  const context: ResourceEnvironmentContext = await resolveResourceEnvironmentContext(input);
  const candidate: ProjectResourceRow = await resolveRequiredResource(context.environment.id, input.query.resourceName);
  assertResourceRunningForManualBackup(candidate);

  return await runWithResourceOperationLock(
    context,
    input.query.resourceName,
    async (resource: ProjectResourceRow): Promise<ResourceBackupResult> => {
      assertResourceRunningForManualBackup(resource);
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
  if (schedule === null || schedule === undefined) {
    return null;
  }
  return await runScheduledBackupAndRetention(context, resource, schedule, now);
}

async function runScheduledBackupAndRetention(
  context: ResourceEnvironmentContext,
  resource: ProjectResourceRow,
  schedule: CompartmentResourceOperationScheduleConfig,
  now: Date,
): Promise<ScheduledResourceBackupRunResult | null> {
  const result: Pick<ResourceBackupResult, 'backup' | 'manifest'> | null = await runScheduledBackupIfDue(
    context,
    resource,
    schedule,
    now,
  );
  const retention: ResourceBackupRetentionResult = await applyResourceBackupRetention({
    context,
    now,
    resource,
    retention: schedule.retention,
  });
  if (result === null && !retention.attempted) {
    return null;
  }
  return buildScheduledResourceBackupRunResult(context, resource, result, retention);
}

async function runScheduledBackupIfDue(
  context: ResourceEnvironmentContext,
  resource: ProjectResourceRow,
  schedule: CompartmentResourceOperationScheduleConfig,
  now: Date,
): Promise<Pick<ResourceBackupResult, 'backup' | 'manifest'> | null> {
  if (resource.status !== 'running') {
    return null;
  }
  if (!(await isScheduledResourceBackupDue(resource, schedule, now))) {
    return null;
  }
  return await runResourceBackup({ actorPrincipalId: null, context, purpose: 'scheduled', resource });
}

function buildScheduledResourceBackupRunResult(
  context: ResourceEnvironmentContext,
  resource: ProjectResourceRow,
  result: Pick<ResourceBackupResult, 'backup' | 'manifest'> | null,
  retention: ResourceBackupRetentionResult,
): ScheduledResourceBackupRunResult {
  return {
    ...context,
    backup: result?.backup ?? null,
    cleanedBackups: retention.cleanedBackups,
    manifest: result?.manifest ?? null,
    recordedFailure: retention.recordedFailure,
    resource,
  };
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
  let candidate: ProjectResourceRow = await readResourceOperationCandidate(context, resourceName);
  for (;;) {
    if (candidate.status === 'deleting') {
      failResourceLookup();
    }
    if (candidate.expectedClaimsJson === '[]') {
      candidate = await waitForResourceClaimIdentities(candidate.id);
    }
    const attempt: LockedResourceOperationResult<Result> = await runLockedResourceOperation(
      context,
      resourceName,
      candidate,
      runOperation,
    );
    if (attempt.nextCandidate === null) {
      return attempt.result;
    }
    candidate = attempt.nextCandidate;
  }
}

async function runLockedResourceOperation<Result>(
  context: ResourceEnvironmentContext,
  resourceName: string,
  candidate: ProjectResourceRow,
  runOperation: (resource: ProjectResourceRow) => Promise<Result>,
): Promise<LockedResourceOperationResult<Result>> {
  return await withResourceOperationLocks([candidate.id], async (): Promise<LockedResourceOperationResult<Result>> => {
    const current: ProjectResourceRow = await readResourceOperationCandidate(context, resourceName);
    if (current.id !== candidate.id) {
      return { nextCandidate: current };
    }
    if (current.status === 'deleting') {
      failResourceLookup();
    }
    if (current.expectedClaimsJson === '[]') {
      return { nextCandidate: current };
    }
    return { nextCandidate: null, result: await runOperation(current) };
  });
}

async function readResourceOperationCandidate(
  context: ResourceEnvironmentContext,
  resourceName: string,
): Promise<ProjectResourceRow> {
  return await getApiDatabase().transaction(async (tx: ResourceTransaction): Promise<ProjectResourceRow> => {
    const archivedAt: Date | null = await lockProjectResourceOperation(tx, context.environment.id, resourceName);
    if (archivedAt !== null) {
      throw createProjectArchivedError();
    }
    return (await lockProjectResourceReferenceByName(tx, context.environment.id, resourceName)) ?? failResourceLookup();
  });
}

async function resolveRequiredResource(environmentId: string, resourceName: string): Promise<ProjectResourceRow> {
  return (await findProjectResourceByName(environmentId, resourceName)) ?? failResourceLookup();
}

function failResourceLookup(): never {
  throw createResourceNotFoundError();
}
