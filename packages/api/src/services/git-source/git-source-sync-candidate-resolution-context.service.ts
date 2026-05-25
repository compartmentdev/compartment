import type { WorkerCompletedGitSourceSyncCandidate } from '@compartment/contracts';
import type { SourceSyncCandidateResolutionContext } from './git-source-sync-completion.context';
import type { PersistedSourceSyncCandidateContext } from './git-source-sync-candidate.support';
import { readMigratableDisconnectedBindingForCandidate } from './git-source-sync-candidate-migration.service';

export function recordCompletedSourceSyncCandidateDiscovery(
  context: SourceSyncCandidateResolutionContext,
  candidates: readonly WorkerCompletedGitSourceSyncCandidate[],
): void {
  for (const candidate of candidates) {
    context.discoveredDescriptorPaths.add(candidate.descriptorPath);
    if (candidate.projectName !== null && candidate.projectName !== '') {
      context.completedCandidateCountsByProjectName.set(
        candidate.projectName,
        (context.completedCandidateCountsByProjectName.get(candidate.projectName) ?? 0) + 1,
      );
    }
  }
}

export function buildPersistedSourceSyncCandidateContext(
  context: SourceSyncCandidateResolutionContext,
): PersistedSourceSyncCandidateContext {
  return {
    activeBindingsByDescriptorPath: context.activeBindingsByDescriptorPath,
    completedCandidateCountsByProjectName: context.completedCandidateCountsByProjectName,
    disconnectedBindingsByDescriptorPath: context.disconnectedBindingsByDescriptorPath,
    disconnectedBindingCountsByProjectName: context.disconnectedBindingCountsByProjectName,
    disconnectedBindingsByProjectName: context.disconnectedBindingsByProjectName,
    discoveredDescriptorPaths: context.discoveredDescriptorPaths,
    excludedDescriptorPaths: context.excludedDescriptorPaths,
    requestedDescriptorPaths: context.requestedDescriptorPaths,
    sourceAutoAdoptNewApps: context.source.autoAdoptNewApps,
    taskAdoptionMode: context.task.adoptionMode,
  };
}

export function readMovedSourceBindingId(
  candidate: WorkerCompletedGitSourceSyncCandidate,
  context: PersistedSourceSyncCandidateContext,
): string | null {
  return readMigratableDisconnectedBindingForCandidate(candidate, context)?.id ?? null;
}
