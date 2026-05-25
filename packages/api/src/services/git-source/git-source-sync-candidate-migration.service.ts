import type { WorkerCompletedGitSourceSyncCandidate } from '@compartment/contracts';
import { hasText } from '@compartment/utils';
import type { SourceBindingRow } from '../../queries/source.query.types';

interface SourceSyncCandidateMigrationContext {
  completedCandidateCountsByProjectName: ReadonlyMap<string, number>;
  disconnectedBindingCountsByProjectName: ReadonlyMap<string, number>;
  disconnectedBindingsByProjectName: ReadonlyMap<string, SourceBindingRow>;
  discoveredDescriptorPaths: ReadonlySet<string>;
}

export function readReservedDisconnectedProjectBlockedReason(
  candidate: WorkerCompletedGitSourceSyncCandidate,
  context: SourceSyncCandidateMigrationContext,
): string | null {
  const disconnectedBinding: SourceBindingRow | null = readDisconnectedBindingForCandidate(candidate, context);
  if (disconnectedBinding === null || disconnectedBinding.descriptorPath === candidate.descriptorPath) {
    return null;
  }
  if (readMigratableDisconnectedBindingForCandidate(candidate, context) !== null) {
    return null;
  }

  return `Project "${candidate.projectName}" already has a disconnected Git binding at ${disconnectedBinding.descriptorPath}.`;
}

export function readMigratableDisconnectedBindingForCandidate(
  candidate: WorkerCompletedGitSourceSyncCandidate,
  context: SourceSyncCandidateMigrationContext,
): SourceBindingRow | null {
  const projectName: string | null = candidate.projectName;
  if (!hasText(projectName)) {
    return null;
  }

  const disconnectedBinding: SourceBindingRow | null = readDisconnectedBindingForProjectName(projectName, context);
  if (!canMigrateDisconnectedBinding(candidate, context, disconnectedBinding, projectName)) {
    return null;
  }

  return disconnectedBinding;
}

function canMigrateDisconnectedBinding(
  candidate: WorkerCompletedGitSourceSyncCandidate,
  context: SourceSyncCandidateMigrationContext,
  binding: SourceBindingRow | null,
  projectName: string,
): binding is SourceBindingRow {
  if (binding === null || binding.descriptorPath === candidate.descriptorPath) {
    return false;
  }

  return (
    !context.discoveredDescriptorPaths.has(binding.descriptorPath) &&
    (context.disconnectedBindingCountsByProjectName.get(projectName) ?? 0) === 1 &&
    (context.completedCandidateCountsByProjectName.get(projectName) ?? 0) === 1
  );
}

function readDisconnectedBindingForCandidate(
  candidate: WorkerCompletedGitSourceSyncCandidate,
  context: SourceSyncCandidateMigrationContext,
): SourceBindingRow | null {
  const projectName: string | null = candidate.projectName;
  if (!hasText(projectName)) {
    return null;
  }

  return readDisconnectedBindingForProjectName(projectName, context);
}

function readDisconnectedBindingForProjectName(
  projectName: string,
  context: SourceSyncCandidateMigrationContext,
): SourceBindingRow | null {
  return context.disconnectedBindingsByProjectName.get(projectName) ?? null;
}
