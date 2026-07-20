import type {
  WorkerCompleteGitSourceSyncTaskRequest,
  WorkerCompletedGitSourceSyncCandidate,
} from '@compartment/contracts';
import { createOrRequeueSourceResolutionTask } from '../../queries/source-resolution.query';
import type { CreateOrRequeueSourceResolutionTaskResult } from '../../queries/source-resolution.query.types';
import { updateSourceSyncMetadata } from '../../queries/source.query';
import type { SourceBindingRow, SourceMutationTransaction, SourceRow } from '../../queries/source.query.types';
import { replaceSourceSyncTaskCandidates } from '../../queries/source-sync.query';
import type { CreateSourceSyncTaskCandidateInput, SourceSyncTaskRow } from '../../queries/source-sync.query.types';
import { recordAuditEvent } from '../audit-events.service';
import type { AuditEventResult } from '../audit-events.service.types';
import { adoptGitSourceBinding } from './git-source-binding-adoption.service';
import { buildGitSourceBindingCreatedAuditEventInput } from './git-source-audit.service';
import type { SourceSyncCandidateResolutionContext } from './git-source-sync-completion.context';
import type { CompleteClaimedGitSourceSyncTaskResult } from './git-source-sync-completion.service.types';
import {
  resolveFencedSourceSyncCompletion,
  type FencedSourceSyncCompletion,
} from './git-source-sync-completion-fence.service';
import {
  buildSourceSyncResolutionTaskInput,
  buildMissingSourceSyncCandidates,
  completeSyntheticSourceSyncResolutionEvent,
  markSourceSyncResolutionEventTasksCreated,
  refreshActiveBindingWatchPaths,
  type GitSourceSyncCompletionState,
} from './git-source-sync-completion.support';
import {
  buildSourceSyncCandidateInput,
  type PersistedSourceSyncCandidateContext,
  readPersistedSourceSyncCandidate,
  requireCandidateProjectName,
} from './git-source-sync-candidate.support';
import {
  buildCompletedCandidateAdoptionInput,
  requireBlockedCandidateInputFromAdoptionError,
} from './git-source-sync-candidate-adoption-input.service';
import {
  buildPersistedSourceSyncCandidateContext,
  recordCompletedSourceSyncCandidateDiscovery,
} from './git-source-sync-candidate-resolution-context.service';
import { orderCompletedSourceSyncCandidates } from './git-source-sync-candidate-ordering.service';
import { queueFollowUpGitSourceSyncTaskAfterClaimedCompletion } from './git-source-sync-task.service';

export async function completeClaimedGitSourceSyncTask(
  transaction: SourceMutationTransaction,
  task: SourceSyncTaskRow,
  source: SourceRow,
  input: WorkerCompleteGitSourceSyncTaskRequest,
  now: Date,
): Promise<CompleteClaimedGitSourceSyncTaskResult | null> {
  const completion: FencedSourceSyncCompletion | null = await resolveFencedSourceSyncCompletion(
    transaction,
    task,
    source,
    input,
    now,
  );
  if (completion === null) {
    return null;
  }

  await persistFencedSourceSyncCompletion(transaction, source, input, completion, now);
  return {
    auditEvents: completion.resolutionContext.auditEvents,
    completedTask: completion.completedTask,
  };
}

async function persistFencedSourceSyncCompletion(
  transaction: SourceMutationTransaction,
  source: SourceRow,
  input: WorkerCompleteGitSourceSyncTaskRequest,
  completion: FencedSourceSyncCompletion,
  now: Date,
): Promise<void> {
  const candidateInputs: CreateSourceSyncTaskCandidateInput[] = await resolveCompletedSourceSyncCandidates(
    completion.resolutionContext,
    input.candidates,
  );
  await finalizeSourceSyncResolutionEvent(transaction, completion.resolutionContext.completionState, now);
  await persistCompletedSourceSyncResults(transaction, completion.liveTask, candidateInputs, now);
  await queueFollowUpGitSourceSyncTaskAfterClaimedCompletion(transaction, source, completion.liveTask);
}

async function finalizeSourceSyncResolutionEvent(
  transaction: SourceMutationTransaction,
  completionState: GitSourceSyncCompletionState,
  now: Date,
): Promise<void> {
  const sourceEventId: string | null = completionState.event.sourceEventId;
  if (sourceEventId === null) {
    return;
  }

  if (completionState.createdResolutionTasks) {
    await markSourceSyncResolutionEventTasksCreated(transaction, sourceEventId, now);
    return;
  }
  if (!completionState.event.synthetic) {
    return;
  }

  await completeSyntheticSourceSyncResolutionEvent(transaction, sourceEventId, now);
}

async function resolveCompletedSourceSyncCandidates(
  context: SourceSyncCandidateResolutionContext,
  candidates: readonly WorkerCompletedGitSourceSyncCandidate[],
): Promise<CreateSourceSyncTaskCandidateInput[]> {
  const candidateInputs: CreateSourceSyncTaskCandidateInput[] = [];
  recordCompletedSourceSyncCandidateDiscovery(context, candidates);

  for (const candidate of orderCompletedSourceSyncCandidates(context, candidates)) {
    const candidateInput: CreateSourceSyncTaskCandidateInput | null = await resolveCompletedSourceSyncCandidate(
      context,
      candidate,
    );
    if (candidateInput !== null) {
      candidateInputs.push(candidateInput);
    }
  }

  candidateInputs.push(...buildMissingSourceSyncCandidates(context));
  return candidateInputs;
}

async function resolveCompletedSourceSyncCandidate(
  context: SourceSyncCandidateResolutionContext,
  candidate: WorkerCompletedGitSourceSyncCandidate,
): Promise<CreateSourceSyncTaskCandidateInput | null> {
  await refreshActiveBindingWatchPaths(context, candidate);
  const candidateContext: PersistedSourceSyncCandidateContext = buildPersistedSourceSyncCandidateContext(context);
  const persistedCandidate: CreateSourceSyncTaskCandidateInput | null | undefined = readPersistedSourceSyncCandidate(
    context.task.id,
    candidate,
    candidateContext,
    context.now,
  );
  if (persistedCandidate !== undefined) {
    await queueRequestedActiveBindingResolutionTask(context, candidate, persistedCandidate);
    return persistedCandidate;
  }

  return await adoptCompletedSourceSyncCandidate(context, candidate, candidateContext);
}

async function queueRequestedActiveBindingResolutionTask(
  context: SourceSyncCandidateResolutionContext,
  candidate: WorkerCompletedGitSourceSyncCandidate,
  persistedCandidate: CreateSourceSyncTaskCandidateInput | null,
): Promise<void> {
  if (persistedCandidate?.status !== 'accepted' || !context.requestedDescriptorPaths.has(candidate.descriptorPath)) {
    return;
  }
  const activeBinding: SourceBindingRow | undefined = context.activeBindingsByDescriptorPath.get(
    candidate.descriptorPath,
  );
  if (activeBinding !== undefined) {
    await queueSourceSyncResolutionTask(context, activeBinding);
  }
}

async function adoptCompletedSourceSyncCandidate(
  context: SourceSyncCandidateResolutionContext,
  candidate: WorkerCompletedGitSourceSyncCandidate,
  candidateContext: PersistedSourceSyncCandidateContext,
): Promise<CreateSourceSyncTaskCandidateInput> {
  const projectName: string = requireCandidateProjectName(candidate.projectName);

  try {
    const adoptedBinding: SourceBindingRow = await adoptGitSourceBinding(
      context.transaction,
      buildCompletedCandidateAdoptionInput(context, candidate, candidateContext, projectName),
      context.now,
    );
    context.activeBindingsByDescriptorPath.set(candidate.descriptorPath, adoptedBinding);
    await queueSourceSyncResolutionTask(context, adoptedBinding);
    await emitAdoptedGitSourceBindingAuditEvent(context, adoptedBinding);
    return buildSourceSyncCandidateInput(context.task.id, candidate, 'accepted', null, context.now);
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    return requireBlockedCandidateInputFromAdoptionError(context, candidate, error);
  }
}

async function emitAdoptedGitSourceBindingAuditEvent(
  context: SourceSyncCandidateResolutionContext,
  binding: SourceBindingRow,
): Promise<void> {
  const auditEvent: AuditEventResult = await recordAuditEvent(
    buildGitSourceBindingCreatedAuditEventInput({
      binding,
      branchName: context.task.requestedBranchName,
      environmentName: context.source.defaultEnvironmentName,
      executor: context.transaction,
      source: context.source,
    }),
  );
  context.auditEvents.push(auditEvent);
}

async function queueSourceSyncResolutionTask(
  context: SourceSyncCandidateResolutionContext,
  binding: SourceBindingRow,
): Promise<void> {
  if (!binding.autoDeployEnabled) {
    return;
  }

  const result: CreateOrRequeueSourceResolutionTaskResult = await createOrRequeueSourceResolutionTask(
    context.transaction,
    await buildSourceSyncResolutionTaskInput(context, binding),
  );
  if (result.queuedForEvent) {
    context.completionState.createdResolutionTasks = true;
  }
}

async function persistCompletedSourceSyncResults(
  transaction: SourceMutationTransaction,
  task: SourceSyncTaskRow,
  candidateInputs: CreateSourceSyncTaskCandidateInput[],
  now: Date,
): Promise<void> {
  await replaceSourceSyncTaskCandidates(transaction, task.id, candidateInputs);
  await updateSourceSyncMetadata(transaction, {
    lastSyncAt: now,
    sourceId: task.sourceId,
    updatedAt: now,
  });
}
