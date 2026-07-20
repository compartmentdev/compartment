import { listSourceExcludedDescriptorsBySourceIdsWithExecutor } from '../../queries/source-exclusion.query';
import { listActiveAndDisconnectedBindingsBySourceIdsWithExecutor } from '../../queries/source.query';
import type {
  SourceBindingRow,
  SourceExcludedDescriptorRow,
  SourceMutationTransaction,
  SourceRow,
} from '../../queries/source.query.types';
import type { SourceSyncTaskRow } from '../../queries/source-sync.query.types';
import type { AuditEventResult } from '../audit-events.service.types';
import { readRequestedDescriptorPaths } from './git-source-sync-candidate.support';
import {
  createGitSourceSyncCompletionState,
  type GitSourceSyncCompletionState,
} from './git-source-sync-completion.support';

export interface SourceSyncCandidateResolutionContext {
  activeBindingsByDescriptorPath: Map<string, SourceBindingRow>;
  auditEvents: AuditEventResult[];
  completionState: GitSourceSyncCompletionState;
  completedCandidateCountsByProjectName: Map<string, number>;
  discoveredDescriptorPaths: Set<string>;
  disconnectedBindingsByDescriptorPath: Map<string, SourceBindingRow>;
  disconnectedBindingCountsByProjectName: Map<string, number>;
  disconnectedBindingsByProjectName: Map<string, SourceBindingRow>;
  excludedDescriptorPaths: Set<string>;
  now: Date;
  requestedDescriptorPaths: Set<string>;
  resolvedCommitSha: string;
  source: SourceRow;
  task: SourceSyncTaskRow;
  transaction: SourceMutationTransaction;
}

interface SourceSyncCandidateBindingContext {
  activeBindingsByDescriptorPath: Map<string, SourceBindingRow>;
  disconnectedBindingsByDescriptorPath: Map<string, SourceBindingRow>;
  disconnectedBindingCountsByProjectName: Map<string, number>;
  disconnectedBindingsByProjectName: Map<string, SourceBindingRow>;
}

export async function buildSourceSyncCandidateResolutionContext(
  transaction: SourceMutationTransaction,
  task: SourceSyncTaskRow,
  source: SourceRow,
  resolvedCommitSha: string,
  now: Date,
): Promise<SourceSyncCandidateResolutionContext> {
  const bindings: SourceBindingRow[] = await listResolutionContextBindings(transaction, source.id);

  return {
    ...buildSourceSyncCandidateBindingContext(bindings),
    auditEvents: [],
    completedCandidateCountsByProjectName: new Map<string, number>(),
    completionState: createGitSourceSyncCompletionState(),
    discoveredDescriptorPaths: new Set<string>(),
    excludedDescriptorPaths: await readExcludedSourceDescriptorPaths(transaction, source.id),
    now,
    requestedDescriptorPaths: readRequestedDescriptorPaths(task.requestedDescriptorPathsJson),
    resolvedCommitSha,
    source,
    task,
    transaction,
  };
}

function buildSourceSyncCandidateBindingContext(
  bindings: readonly SourceBindingRow[],
): SourceSyncCandidateBindingContext {
  return {
    activeBindingsByDescriptorPath: buildBindingsByDescriptorPath(bindings, 'active'),
    disconnectedBindingsByDescriptorPath: buildBindingsByDescriptorPath(bindings, 'disconnected'),
    disconnectedBindingCountsByProjectName: buildBindingCountsByProjectName(bindings, 'disconnected'),
    disconnectedBindingsByProjectName: buildBindingsByProjectName(bindings, 'disconnected'),
  };
}

function buildBindingCountsByProjectName(
  bindings: readonly SourceBindingRow[],
  status: 'active' | 'disconnected',
): Map<string, number> {
  const countsByProjectName: Map<string, number> = new Map<string, number>();

  for (const binding of bindings) {
    if (binding.status !== status) {
      continue;
    }

    countsByProjectName.set(binding.projectName, (countsByProjectName.get(binding.projectName) ?? 0) + 1);
  }

  return countsByProjectName;
}

async function listResolutionContextBindings(
  transaction: SourceMutationTransaction,
  sourceId: string,
): Promise<SourceBindingRow[]> {
  return await listActiveAndDisconnectedBindingsBySourceIdsWithExecutor(transaction, [sourceId]);
}

function buildBindingsByDescriptorPath(
  bindings: readonly SourceBindingRow[],
  status: 'active' | 'disconnected',
): Map<string, SourceBindingRow> {
  const bindingsByDescriptorPath: Map<string, SourceBindingRow> = new Map<string, SourceBindingRow>();

  for (const binding of bindings) {
    if (binding.status !== status) {
      continue;
    }

    bindingsByDescriptorPath.set(binding.descriptorPath, binding);
  }

  return bindingsByDescriptorPath;
}

function buildBindingsByProjectName(
  bindings: readonly SourceBindingRow[],
  status: 'active' | 'disconnected',
): Map<string, SourceBindingRow> {
  const bindingsByProjectName: Map<string, SourceBindingRow> = new Map<string, SourceBindingRow>();

  for (const binding of bindings) {
    if (binding.status !== status) {
      continue;
    }

    bindingsByProjectName.set(binding.projectName, binding);
  }

  return bindingsByProjectName;
}

async function readExcludedSourceDescriptorPaths(
  transaction: SourceMutationTransaction,
  sourceId: string,
): Promise<Set<string>> {
  const exclusions: SourceExcludedDescriptorRow[] = await listSourceExcludedDescriptorsBySourceIdsWithExecutor(
    transaction,
    [sourceId],
  );
  return new Set<string>(exclusions.map((exclusion: SourceExcludedDescriptorRow): string => exclusion.descriptorPath));
}
