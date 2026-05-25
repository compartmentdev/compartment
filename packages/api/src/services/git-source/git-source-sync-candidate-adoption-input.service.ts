import type { WorkerCompletedGitSourceSyncCandidate } from '@compartment/contracts';
import type { CreateSourceSyncTaskCandidateInput } from '../../queries/source-sync.query.types';
import type { AdoptGitSourceBindingInput } from './git-source-binding-adoption.service';
import type { SourceSyncCandidateResolutionContext } from './git-source-sync-completion.context';
import {
  buildSourceSyncBindingAdoptionInput,
  buildSourceSyncCandidateInput,
  type PersistedSourceSyncCandidateContext,
  readCandidateAdoptionBlockedReason,
} from './git-source-sync-candidate.support';
import { readMovedSourceBindingId } from './git-source-sync-candidate-resolution-context.service';

export function buildCompletedCandidateAdoptionInput(
  context: SourceSyncCandidateResolutionContext,
  candidate: WorkerCompletedGitSourceSyncCandidate,
  candidateContext: PersistedSourceSyncCandidateContext,
  projectName: string,
): AdoptGitSourceBindingInput {
  return buildSourceSyncBindingAdoptionInput(
    context.task,
    context.source,
    candidate,
    projectName,
    readMovedSourceBindingId(candidate, candidateContext),
  );
}

export function requireBlockedCandidateInputFromAdoptionError(
  context: SourceSyncCandidateResolutionContext,
  candidate: WorkerCompletedGitSourceSyncCandidate,
  error: Error,
): CreateSourceSyncTaskCandidateInput {
  const blockedReason: string | null = readCandidateAdoptionBlockedReason(error);
  if (blockedReason === null) {
    throw error;
  }

  return buildSourceSyncCandidateInput(context.task.id, candidate, 'blocked', blockedReason, context.now);
}
