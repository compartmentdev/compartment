import type { WorkerCompletedGitSourceSyncCandidate } from '@compartment/contracts';
import type { SourceSyncCandidateResolutionContext } from './git-source-sync-completion.context';

export function orderCompletedSourceSyncCandidates(
  context: SourceSyncCandidateResolutionContext,
  candidates: readonly WorkerCompletedGitSourceSyncCandidate[],
): WorkerCompletedGitSourceSyncCandidate[] {
  const knownBindingCandidates: WorkerCompletedGitSourceSyncCandidate[] = [];
  const unboundCandidates: WorkerCompletedGitSourceSyncCandidate[] = [];

  for (const candidate of candidates) {
    if (
      context.activeBindingsByDescriptorPath.has(candidate.descriptorPath) ||
      context.disconnectedBindingsByDescriptorPath.has(candidate.descriptorPath)
    ) {
      knownBindingCandidates.push(candidate);
      continue;
    }

    unboundCandidates.push(candidate);
  }

  return [...knownBindingCandidates, ...unboundCandidates];
}
