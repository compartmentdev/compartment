import { sourceSyncTaskMaxAttempts } from '../../git-source.constants';
import { createGitSourceConflictError } from '../../errors/api-business-error';
import { createId } from '../../lib/tokens';
import { findLatestSourcePushEventSinceWithExecutor } from '../../queries/source-resolution-event.query';
import { lockSourceMutationWithExecutor } from '../../queries/source.query';
import type { SourceMutationTransaction, SourceRow } from '../../queries/source.query.types';
import {
  createSourceSyncTask,
  findLatestSourceSyncTaskBySourceIdWithExecutor,
  replaceSourceSyncTaskCandidates,
  resetSourceSyncTaskToPending,
  updateLiveSourceSyncTaskOptions,
} from '../../queries/source-sync.query';
import type { SourceSyncTaskRow, UpdateLiveSourceSyncTaskOptionsInput } from '../../queries/source-sync.query.types';
import { ensureSourceAutomationPrincipalWithExecutor } from './git-source-automation-principal.service';
import {
  buildBootstrapGitSourceSyncTaskRequest,
  buildIncrementalGitSourceSyncTaskRequest,
  buildNextLiveSourceSyncTaskOptions as buildLiveSourceSyncTaskOptions,
  hasSameLiveSourceSyncTaskOptions,
  type GitSourceSyncTaskRequest,
  readLiveSourceSyncTaskRequestDisposition,
} from './git-source-sync-task.support';

const sourceSyncTaskInProgressConflictMessage: string =
  'A source sync is already in progress. Retry after the current sync completes.';

export async function queueGitSourceSyncTaskForPush(
  transaction: SourceMutationTransaction,
  source: SourceRow,
  branchName: string,
  triggerSourceEventId: string,
  triggerCommitSha: string,
): Promise<void> {
  if (branchName !== source.syncBranchName) {
    return;
  }

  const automationPrincipalId: string = await ensureSourceAutomationPrincipalWithExecutor(transaction, source);
  await readOrCreateGitSourceSyncTaskId(
    transaction,
    source,
    buildIncrementalGitSourceSyncTaskRequest('push', automationPrincipalId, [], triggerSourceEventId, triggerCommitSha),
  );
}

export async function queueGitSourceSyncTaskForConnect(
  transaction: SourceMutationTransaction,
  source: SourceRow,
  actorPrincipalId: string,
): Promise<string> {
  return await readOrCreateGitSourceSyncTaskId(
    transaction,
    source,
    buildBootstrapGitSourceSyncTaskRequest(actorPrincipalId),
  );
}

export async function readOrCreateGitSourceSyncTaskIdForStart(
  transaction: SourceMutationTransaction,
  source: SourceRow,
  actorPrincipalId: string,
): Promise<string> {
  return await readOrCreateGitSourceSyncTaskId(
    transaction,
    source,
    buildIncrementalGitSourceSyncTaskRequest('manual', actorPrincipalId, [], null, null),
  );
}

export async function readOrCreateGitSourceSyncTaskIdForInclude(
  transaction: SourceMutationTransaction,
  source: SourceRow,
  descriptorPath: string,
  actorPrincipalId: string,
): Promise<string> {
  return await readOrCreateGitSourceSyncTaskId(
    transaction,
    source,
    buildIncrementalGitSourceSyncTaskRequest('include', actorPrincipalId, [descriptorPath], null, null),
  );
}

export async function queueFollowUpGitSourceSyncTaskAfterClaimedCompletion(
  transaction: SourceMutationTransaction,
  source: SourceRow,
  task: SourceSyncTaskRow,
): Promise<void> {
  if (task.claimedAt === null) {
    return;
  }

  const latestPush: { commitSha: string; sourceEventId: string } | undefined = await readLatestFollowUpSourcePush(
    transaction,
    source,
    task.createdAt,
  );
  if (latestPush === undefined) {
    return;
  }
  await queueFollowUpAutomationSourceSyncTask(transaction, source, latestPush.sourceEventId, latestPush.commitSha);
}

async function queueFollowUpAutomationSourceSyncTask(
  transaction: SourceMutationTransaction,
  source: SourceRow,
  triggerSourceEventId: string,
  triggerCommitSha: string,
): Promise<void> {
  const automationPrincipalId: string = await ensureSourceAutomationPrincipalWithExecutor(transaction, source);
  await readOrCreateGitSourceSyncTaskId(
    transaction,
    source,
    buildIncrementalGitSourceSyncTaskRequest('push', automationPrincipalId, [], triggerSourceEventId, triggerCommitSha),
  );
}

async function readOrCreateGitSourceSyncTaskId(
  transaction: SourceMutationTransaction,
  source: SourceRow,
  request: GitSourceSyncTaskRequest,
): Promise<string> {
  const latestTask: SourceSyncTaskRow | undefined = await readLockedLatestSourceSyncTask(transaction, source.id);
  if (hasLiveSourceSyncTask(latestTask)) {
    return await updateLiveGitSourceSyncTaskIfNeeded(transaction, latestTask, request);
  }
  if (isResettableSourceSyncTask(latestTask)) {
    return await resetFailedGitSourceSyncTask(transaction, latestTask, source.syncBranchName, request);
  }

  return await createPendingGitSourceSyncTask(transaction, source.id, source.syncBranchName, request);
}

async function readLockedLatestSourceSyncTask(
  transaction: SourceMutationTransaction,
  sourceId: string,
): Promise<SourceSyncTaskRow | undefined> {
  await lockSourceMutationWithExecutor(transaction, sourceId);
  return await findLatestSourceSyncTaskBySourceIdWithExecutor(transaction, sourceId);
}

async function updateLiveGitSourceSyncTaskIfNeeded(
  transaction: SourceMutationTransaction,
  task: SourceSyncTaskRow,
  request: GitSourceSyncTaskRequest,
): Promise<string> {
  const disposition: 'conflict' | 'reuse' | 'update' = readLiveSourceSyncTaskRequestDisposition(task, request);
  if (disposition === 'reuse') {
    return task.id;
  }
  if (disposition === 'conflict') {
    throw createGitSourceConflictError(sourceSyncTaskInProgressConflictMessage);
  }

  const nextOptions: UpdateLiveSourceSyncTaskOptionsInput = buildLiveSourceSyncTaskOptions(task, request);
  if (hasSameLiveSourceSyncTaskOptions(task, nextOptions)) {
    return task.id;
  }

  return (await updateLiveSourceSyncTaskOptions(transaction, nextOptions)).id;
}

async function readLatestFollowUpSourcePush(
  transaction: SourceMutationTransaction,
  source: SourceRow,
  taskCreatedAt: Date,
): Promise<{ commitSha: string; sourceEventId: string } | undefined> {
  return await findLatestSourcePushEventSinceWithExecutor(transaction, source.id, source.syncBranchName, taskCreatedAt);
}

function hasLiveSourceSyncTask(task: SourceSyncTaskRow | undefined): task is SourceSyncTaskRow {
  return task?.status === 'pending' || task?.status === 'claimed';
}
function isResettableSourceSyncTask(task: SourceSyncTaskRow | undefined): task is SourceSyncTaskRow {
  return task?.status === 'failed' || task?.status === 'canceled';
}

async function createPendingGitSourceSyncTask(
  transaction: SourceMutationTransaction,
  sourceId: string,
  requestedBranchName: string,
  request: GitSourceSyncTaskRequest,
): Promise<string> {
  return (
    await createSourceSyncTask(transaction, {
      adoptionMode: request.adoptionMode,
      id: createId('sst'),
      maxAttempts: sourceSyncTaskMaxAttempts,
      requestedByPrincipalId: request.requestedByPrincipalId,
      requestedBranchName,
      requestedDescriptorPathsJson: JSON.stringify(request.requestedDescriptorPaths),
      sourceId,
      status: 'pending',
      triggerCommitSha: request.triggerCommitSha,
      triggerSourceEventId: request.triggerSourceEventId,
      updatedAt: new Date(),
    })
  ).id;
}

async function resetFailedGitSourceSyncTask(
  transaction: SourceMutationTransaction,
  task: SourceSyncTaskRow,
  requestedBranchName: string,
  request: GitSourceSyncTaskRequest,
): Promise<string> {
  await replaceSourceSyncTaskCandidates(transaction, task.id, []);

  return (
    await resetSourceSyncTaskToPending(transaction, {
      adoptionMode: request.adoptionMode,
      id: task.id,
      requestedByPrincipalId: request.requestedByPrincipalId,
      requestedBranchName,
      requestedDescriptorPathsJson: JSON.stringify(request.requestedDescriptorPaths),
      triggerCommitSha: request.triggerCommitSha,
      triggerSourceEventId: request.triggerSourceEventId,
      updatedAt: new Date(),
    })
  ).id;
}
