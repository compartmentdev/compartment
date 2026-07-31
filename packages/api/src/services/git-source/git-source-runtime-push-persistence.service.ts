import { createId } from '../../lib/tokens';
import { sourceResolutionTaskMaxAttempts } from '../../git-source.constants';
import { createOrRequeueSourceResolutionTask } from '../../queries/source-resolution.query';
import type {
  CreateOrRequeueSourceResolutionTaskResult,
  CreateSourceResolutionTaskInput,
  SourceEventRow,
  SourceResolutionMutationTransaction,
} from '../../queries/source-resolution.query.types';
import {
  listActiveBindingsBySourceIdsWithExecutor,
  listBranchMappingsByBindingIdsWithExecutor,
} from '../../queries/source.query';
import type { SourceBindingBranchMappingRow, SourceBindingRow, SourceRow } from '../../queries/source.query.types';
import type { BuildGitSourcePushAuditEventInputsInput } from './git-source-audit.service.types';
import type {
  CreateBindingResolutionTasksInput,
  ProviderPushDeliveryInput,
  PersistSourcePushEventInput,
  PushChangedFilesState,
} from './git-source-runtime.service.types';
import { isBindingAffectedByPush } from './git-source-runtime.support';
import {
  createSourcePushEventIfMissing,
  updateSourcePushEventCompletion,
} from './git-source-runtime-push-event.service';
import { queueGitSourceSyncTaskForPush } from './git-source-sync-task.service';

interface PersistSourcePushEventsForAuditInput {
  branchName: string;
  changedFilesState: PushChangedFilesState;
  commitSha: string;
  payloadJson: string;
  sources: readonly SourceRow[];
}

export async function persistSourcePushEventsForAudit(
  tx: SourceResolutionMutationTransaction,
  input: ProviderPushDeliveryInput,
  eventInput: PersistSourcePushEventsForAuditInput,
): Promise<BuildGitSourcePushAuditEventInputsInput[]> {
  const auditEvents: BuildGitSourcePushAuditEventInputsInput[] = [];
  for (const source of eventInput.sources) {
    const auditEvent: BuildGitSourcePushAuditEventInputsInput | null = await persistSourcePushEvent(tx, input, {
      ...eventInput,
      source,
    });
    if (auditEvent !== null) {
      auditEvents.push(auditEvent);
    }
  }
  return auditEvents;
}

async function persistSourcePushEvent(
  tx: SourceResolutionMutationTransaction,
  input: ProviderPushDeliveryInput,
  eventInput: PersistSourcePushEventInput,
): Promise<BuildGitSourcePushAuditEventInputsInput | null> {
  const event: SourceEventRow | null = await createSourcePushEventIfMissing(
    tx,
    input,
    eventInput.source.id,
    eventInput.branchName,
    eventInput.commitSha,
    eventInput.payloadJson,
    eventInput.changedFilesState,
  );
  if (event === null) {
    return null;
  }

  const resolutionTaskCount: number = await queueTasksForCreatedSourcePushEvent(tx, event, eventInput);
  return buildGitSourcePushAuditEventInput(input.providerDeliveryId, eventInput, resolutionTaskCount);
}

function buildGitSourcePushAuditEventInput(
  providerDeliveryId: string,
  eventInput: PersistSourcePushEventInput,
  resolutionTaskCount: number,
): BuildGitSourcePushAuditEventInputsInput {
  return {
    branchName: eventInput.branchName,
    changedFilesComplete: eventInput.changedFilesState.changedFilesComplete,
    changedFilesCount: eventInput.changedFilesState.changedFiles.length,
    commitSha: eventInput.commitSha,
    providerDeliveryId,
    resolutionTaskCount,
    source: eventInput.source,
  };
}

async function queueTasksForCreatedSourcePushEvent(
  tx: SourceResolutionMutationTransaction,
  event: SourceEventRow,
  eventInput: PersistSourcePushEventInput,
): Promise<number> {
  const createdTaskCount: number = await createResolutionTasksForSourceEvent(
    tx,
    eventInput.source,
    event.id,
    eventInput.branchName,
    eventInput.commitSha,
    eventInput.changedFilesState,
  );
  await queueGitSourceSyncTaskForPush(tx, eventInput.source, eventInput.branchName, event.id, eventInput.commitSha);
  await updateSourcePushEventCompletion(tx, event.id, createdTaskCount);
  return createdTaskCount;
}

async function createResolutionTasksForSourceEvent(
  tx: SourceResolutionMutationTransaction,
  source: SourceRow,
  sourceEventId: string,
  branchName: string,
  commitSha: string,
  changedFilesState: PushChangedFilesState,
): Promise<number> {
  const bindings: SourceBindingRow[] = await listActiveBindingsBySourceIdsWithExecutor(tx, [source.id]);
  const branchMappings: SourceBindingBranchMappingRow[] = await readBindingBranchMappings(tx, bindings);
  let createdTaskCount: number = 0;

  for (const binding of bindings) {
    createdTaskCount += await createBindingResolutionTasks(tx, {
      binding,
      branchMappings,
      branchName,
      changedFilesState,
      commitSha,
      source,
      sourceEventId,
    });
  }

  return createdTaskCount;
}

async function readBindingBranchMappings(
  tx: SourceResolutionMutationTransaction,
  bindings: readonly SourceBindingRow[],
): Promise<SourceBindingBranchMappingRow[]> {
  return await listBranchMappingsByBindingIdsWithExecutor(
    tx,
    bindings.map((binding: SourceBindingRow): string => binding.id),
  );
}

async function createBindingResolutionTasks(
  tx: SourceResolutionMutationTransaction,
  input: CreateBindingResolutionTasksInput,
): Promise<number> {
  const matchingBranchMappings: SourceBindingBranchMappingRow[] | null = readAffectedBindingBranchMappings(input);
  if (matchingBranchMappings === null) {
    return 0;
  }

  return await createEnvironmentResolutionTasks(
    tx,
    input.source,
    input.binding.id,
    input.sourceEventId,
    matchingBranchMappings,
    input.branchName,
    input.commitSha,
  );
}

function readAffectedBindingBranchMappings(
  input: CreateBindingResolutionTasksInput,
): SourceBindingBranchMappingRow[] | null {
  const matchingBranchMappings: SourceBindingBranchMappingRow[] = readMatchingBindingBranchMappings(
    input.branchMappings,
    input.binding.id,
    input.branchName,
  );

  return isBindingAffectedByPush(
    input.binding,
    matchingBranchMappings,
    input.branchName,
    input.changedFilesState.changedFiles,
    input.changedFilesState.changedFilesComplete,
  )
    ? matchingBranchMappings
    : null;
}

async function createEnvironmentResolutionTasks(
  tx: SourceResolutionMutationTransaction,
  source: SourceRow,
  sourceBindingId: string,
  sourceEventId: string,
  branchMappings: readonly SourceBindingBranchMappingRow[],
  branchName: string,
  commitSha: string,
): Promise<number> {
  let queuedTaskCount: number = 0;
  for (const mapping of branchMappings) {
    if (
      await createEnvironmentResolutionTask(tx, source, sourceBindingId, sourceEventId, mapping, branchName, commitSha)
    ) {
      queuedTaskCount += 1;
    }
  }

  return queuedTaskCount;
}

async function createEnvironmentResolutionTask(
  tx: SourceResolutionMutationTransaction,
  source: SourceRow,
  sourceBindingId: string,
  sourceEventId: string,
  mapping: SourceBindingBranchMappingRow,
  branchName: string,
  commitSha: string,
): Promise<boolean> {
  const result: CreateOrRequeueSourceResolutionTaskResult = await createOrRequeueSourceResolutionTask(
    tx,
    buildSourceResolutionTaskInput(source, sourceBindingId, sourceEventId, mapping, branchName, commitSha),
  );

  return result.queuedForEvent;
}

function buildSourceResolutionTaskInput(
  source: SourceRow,
  sourceBindingId: string,
  sourceEventId: string,
  mapping: SourceBindingBranchMappingRow,
  branchName: string,
  commitSha: string,
): CreateSourceResolutionTaskInput {
  return {
    branchName,
    commitSha,
    id: createId('srt'),
    maxAttempts: sourceResolutionTaskMaxAttempts,
    sourceBindingId,
    sourceEventId,
    sourceId: source.id,
    status: 'pending',
    targetEnvironmentName: mapping.environmentName,
    updatedAt: new Date(),
  };
}

function readMatchingBindingBranchMappings(
  branchMappings: readonly SourceBindingBranchMappingRow[],
  sourceBindingId: string,
  branchName: string,
): SourceBindingBranchMappingRow[] {
  return branchMappings.filter(
    (mapping: SourceBindingBranchMappingRow): boolean =>
      mapping.sourceBindingId === sourceBindingId && mapping.branchName === branchName,
  );
}
