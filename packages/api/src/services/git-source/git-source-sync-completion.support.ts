import type { WorkerCompletedGitSourceSyncCandidate } from '@compartment/contracts';
import { createId } from '../../lib/tokens';
import { sourceResolutionTaskMaxAttempts } from '../../git-source.constants';
import { createOrGetSourceEvent, updateSourceEventStatus } from '../../queries/source-resolution.query';
import { updateSourceBindingWatchPaths } from '../../queries/source.query';
import type {
  CreateOrGetSourceEventResult,
  CreateSourceResolutionTaskInput,
  SourceEventType,
} from '../../queries/source-resolution.query.types';
import type { SourceBindingRow, SourceMutationTransaction, SourceRow } from '../../queries/source.query.types';
import type { CreateSourceSyncTaskCandidateInput, SourceSyncTaskRow } from '../../queries/source-sync.query.types';
import type { SourceSyncCandidateResolutionContext } from './git-source-sync-completion.context';
import {
  buildMissingSourceSyncCandidateInput,
  readBindingCandidateBlockedReason,
} from './git-source-sync-candidate.support';

const sourceSyncEventType: SourceEventType = 'source_sync';

export interface GitSourceSyncEventState {
  sourceEventId: string | null;
  synthetic: boolean;
}

export interface GitSourceSyncCompletionState {
  createdResolutionTasks: boolean;
  event: GitSourceSyncEventState;
}

export function createGitSourceSyncCompletionState(): GitSourceSyncCompletionState {
  return {
    createdResolutionTasks: false,
    event: {
      sourceEventId: null,
      synthetic: false,
    },
  };
}

export async function buildSourceSyncResolutionTaskInput(
  context: SourceSyncCandidateResolutionContext,
  binding: SourceBindingRow,
): Promise<CreateSourceResolutionTaskInput> {
  return {
    branchName: context.task.requestedBranchName,
    commitSha: readSourceSyncResolutionCommitSha(context.task, context.resolvedCommitSha),
    id: createId('srt'),
    maxAttempts: sourceResolutionTaskMaxAttempts,
    sourceBindingId: binding.id,
    sourceEventId: await readSourceSyncResolutionEventId(context),
    sourceId: context.source.id,
    status: 'pending',
    targetEnvironmentName: context.source.defaultEnvironmentName,
    updatedAt: context.now,
  };
}

export async function refreshActiveBindingWatchPaths(
  context: SourceSyncCandidateResolutionContext,
  candidate: WorkerCompletedGitSourceSyncCandidate,
): Promise<void> {
  const activeBinding: SourceBindingRow | undefined = readRefreshableActiveBinding(context, candidate);
  if (activeBinding === undefined) {
    return;
  }

  const watchPathsJson: string = JSON.stringify(candidate.derivedWatchPaths);
  if (activeBinding.watchPathsJson === watchPathsJson) {
    return;
  }

  const updatedBinding: SourceBindingRow = await updateSourceBindingWatchPaths(context.transaction, {
    sourceBindingId: activeBinding.id,
    updatedAt: context.now,
    watchPathsJson,
  });
  context.activeBindingsByDescriptorPath.set(candidate.descriptorPath, updatedBinding);
}

function readRefreshableActiveBinding(
  context: SourceSyncCandidateResolutionContext,
  candidate: WorkerCompletedGitSourceSyncCandidate,
): SourceBindingRow | undefined {
  if (context.excludedDescriptorPaths.has(candidate.descriptorPath)) {
    return undefined;
  }

  const activeBinding: SourceBindingRow | undefined = context.activeBindingsByDescriptorPath.get(
    candidate.descriptorPath,
  );
  if (activeBinding === undefined) {
    return undefined;
  }

  return readBindingCandidateBlockedReason(candidate, activeBinding.projectName) === null ? activeBinding : undefined;
}

async function readSourceSyncResolutionEventId(context: SourceSyncCandidateResolutionContext): Promise<string> {
  const existingEventId: string | null = readExistingSourceSyncResolutionEventId(context.task, context.completionState);
  if (existingEventId !== null) {
    return existingEventId;
  }

  return await createSyntheticSourceSyncResolutionEvent(
    context.transaction,
    context.task,
    context.source,
    context.resolvedCommitSha,
    context.completionState,
    context.now,
  );
}

function readExistingSourceSyncResolutionEventId(
  task: SourceSyncTaskRow,
  completionState: GitSourceSyncCompletionState,
): string | null {
  if (task.triggerSourceEventId !== null) {
    completionState.event.sourceEventId = task.triggerSourceEventId;
    completionState.event.synthetic = false;
    return task.triggerSourceEventId;
  }

  return completionState.event.sourceEventId;
}

async function createSyntheticSourceSyncResolutionEvent(
  transaction: SourceMutationTransaction,
  task: SourceSyncTaskRow,
  source: SourceRow,
  resolvedCommitSha: string,
  completionState: GitSourceSyncCompletionState,
  now: Date,
): Promise<string> {
  const event: CreateOrGetSourceEventResult = await createOrGetSourceEvent(transaction, {
    branchName: task.requestedBranchName,
    changedFilesComplete: true,
    changedFilesJson: '[]',
    commitSha: readSourceSyncResolutionCommitSha(task, resolvedCommitSha),
    eventType: sourceSyncEventType,
    id: createId('sev'),
    payloadJson: JSON.stringify({ sourceSyncTaskId: task.id }),
    providerDeliveryId: `source-sync:${task.id}`,
    sourceId: source.id,
    status: 'received',
    updatedAt: now,
  });
  completionState.event.sourceEventId = event.event.id;
  completionState.event.synthetic = true;
  return event.event.id;
}

function readSourceSyncResolutionCommitSha(task: SourceSyncTaskRow, resolvedCommitSha: string): string {
  return task.triggerCommitSha ?? resolvedCommitSha;
}

export async function markSourceSyncResolutionEventTasksCreated(
  transaction: SourceMutationTransaction,
  sourceEventId: string,
  now: Date,
): Promise<void> {
  await updateSourceEventStatus(transaction, {
    completedAt: null,
    sourceEventId,
    status: 'tasks_created',
    updatedAt: now,
  });
}

export async function completeSyntheticSourceSyncResolutionEvent(
  transaction: SourceMutationTransaction,
  sourceEventId: string,
  now: Date,
): Promise<void> {
  await updateSourceEventStatus(transaction, {
    completedAt: now,
    sourceEventId,
    status: 'completed',
    updatedAt: now,
  });
}

export function buildMissingSourceSyncCandidates(
  context: SourceSyncCandidateResolutionContext,
): CreateSourceSyncTaskCandidateInput[] {
  const missingActiveDescriptorPaths: Set<string> = new Set<string>();
  const candidateInputs: CreateSourceSyncTaskCandidateInput[] = [
    ...buildMissingActiveBindingCandidates(context, missingActiveDescriptorPaths),
    ...buildMissingRequestedDescriptorCandidates(context, missingActiveDescriptorPaths),
  ];
  return candidateInputs.sort(compareSourceSyncCandidatesByDescriptorPath);
}

function buildMissingActiveBindingCandidates(
  context: SourceSyncCandidateResolutionContext,
  missingActiveDescriptorPaths: Set<string>,
): CreateSourceSyncTaskCandidateInput[] {
  const candidateInputs: CreateSourceSyncTaskCandidateInput[] = [];

  for (const [descriptorPath, binding] of context.activeBindingsByDescriptorPath) {
    if (shouldSkipMissingSourceSyncCandidate(context, descriptorPath)) {
      continue;
    }

    candidateInputs.push(
      buildMissingSourceSyncCandidateInput(context.task.id, descriptorPath, binding.projectName, context.now),
    );
    missingActiveDescriptorPaths.add(descriptorPath);
  }

  return candidateInputs;
}

function buildMissingRequestedDescriptorCandidates(
  context: SourceSyncCandidateResolutionContext,
  missingActiveDescriptorPaths: ReadonlySet<string>,
): CreateSourceSyncTaskCandidateInput[] {
  const candidateInputs: CreateSourceSyncTaskCandidateInput[] = [];

  for (const descriptorPath of context.requestedDescriptorPaths) {
    if (shouldSkipRequestedMissingSourceSyncCandidate(context, descriptorPath, missingActiveDescriptorPaths)) {
      continue;
    }

    candidateInputs.push(buildMissingSourceSyncCandidateInput(context.task.id, descriptorPath, null, context.now));
  }

  return candidateInputs;
}

function shouldSkipRequestedMissingSourceSyncCandidate(
  context: SourceSyncCandidateResolutionContext,
  descriptorPath: string,
  missingActiveDescriptorPaths: ReadonlySet<string>,
): boolean {
  return (
    shouldSkipMissingSourceSyncCandidate(context, descriptorPath) || missingActiveDescriptorPaths.has(descriptorPath)
  );
}

function shouldSkipMissingSourceSyncCandidate(
  context: SourceSyncCandidateResolutionContext,
  descriptorPath: string,
): boolean {
  return context.discoveredDescriptorPaths.has(descriptorPath) || context.excludedDescriptorPaths.has(descriptorPath);
}

function compareSourceSyncCandidatesByDescriptorPath(
  left: CreateSourceSyncTaskCandidateInput,
  right: CreateSourceSyncTaskCandidateInput,
): number {
  return left.descriptorPath.localeCompare(right.descriptorPath);
}
