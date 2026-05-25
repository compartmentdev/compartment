import type {
  SourceSyncTaskAdoptionMode,
  SourceSyncTaskRow,
  UpdateLiveSourceSyncTaskOptionsInput,
} from '../../queries/source-sync.query.types';
import { readGitSourceJsonStringArray } from './git-source-json.support';

export type GitSourceSyncTaskRequestKind = 'bootstrap' | 'include' | 'manual' | 'push';
export interface GitSourceSyncTaskRequest {
  adoptionMode: SourceSyncTaskAdoptionMode;
  kind: GitSourceSyncTaskRequestKind;
  requestedByPrincipalId: string;
  requestedDescriptorPaths: readonly string[];
  triggerCommitSha: string | null;
  triggerSourceEventId: string | null;
}

export function readLiveSourceSyncTaskRequestDisposition(
  task: Pick<SourceSyncTaskRow, 'requestedByPrincipalId' | 'requestedDescriptorPathsJson'>,
  request: Pick<GitSourceSyncTaskRequest, 'kind' | 'requestedByPrincipalId'>,
): 'conflict' | 'reuse' | 'update' {
  switch (request.kind) {
    case 'include':
      return task.requestedByPrincipalId === request.requestedByPrincipalId ? 'update' : 'conflict';
    case 'push':
      return task.requestedByPrincipalId === request.requestedByPrincipalId &&
        task.requestedDescriptorPathsJson === '[]'
        ? 'update'
        : 'reuse';
    case 'bootstrap':
      return task.requestedByPrincipalId === request.requestedByPrincipalId ? 'update' : 'reuse';
    case 'manual':
      return 'reuse';
  }
}

export function buildNextLiveSourceSyncTaskOptions(
  task: SourceSyncTaskRow,
  request: GitSourceSyncTaskRequest,
): UpdateLiveSourceSyncTaskOptionsInput {
  return {
    adoptionMode: readNextSourceSyncTaskAdoptionMode(task.adoptionMode, request.adoptionMode),
    id: task.id,
    requestedByPrincipalId: request.requestedByPrincipalId,
    requestedDescriptorPathsJson: JSON.stringify(
      mergeRequestedSourceDescriptorPaths(
        readGitSourceJsonStringArray(task.requestedDescriptorPathsJson),
        request.requestedDescriptorPaths,
      ),
    ),
    triggerCommitSha: request.triggerCommitSha ?? task.triggerCommitSha,
    triggerSourceEventId: request.triggerSourceEventId ?? task.triggerSourceEventId,
    updatedAt: new Date(),
  };
}

function readNextSourceSyncTaskAdoptionMode(
  existingMode: SourceSyncTaskAdoptionMode,
  requestedMode: SourceSyncTaskAdoptionMode,
): SourceSyncTaskAdoptionMode {
  return existingMode === 'bootstrap' || requestedMode === 'bootstrap' ? 'bootstrap' : 'incremental';
}

function mergeRequestedSourceDescriptorPaths(
  existingPaths: readonly string[],
  requestedPaths: readonly string[],
): string[] {
  return [...new Set<string>([...existingPaths, ...requestedPaths])].sort((left: string, right: string): number =>
    left.localeCompare(right),
  );
}

export function hasSameLiveSourceSyncTaskOptions(
  task: SourceSyncTaskRow,
  nextOptions: UpdateLiveSourceSyncTaskOptionsInput,
): boolean {
  return (
    task.adoptionMode === nextOptions.adoptionMode &&
    task.requestedByPrincipalId === nextOptions.requestedByPrincipalId &&
    task.requestedDescriptorPathsJson === nextOptions.requestedDescriptorPathsJson &&
    task.triggerCommitSha === nextOptions.triggerCommitSha &&
    task.triggerSourceEventId === nextOptions.triggerSourceEventId
  );
}

export function buildBootstrapGitSourceSyncTaskRequest(actorPrincipalId: string): GitSourceSyncTaskRequest {
  return {
    adoptionMode: 'bootstrap',
    kind: 'bootstrap',
    requestedByPrincipalId: actorPrincipalId,
    requestedDescriptorPaths: [],
    triggerCommitSha: null,
    triggerSourceEventId: null,
  };
}

export function buildIncrementalGitSourceSyncTaskRequest(
  kind: GitSourceSyncTaskRequestKind,
  requestedByPrincipalId: string,
  requestedDescriptorPaths: readonly string[],
  triggerSourceEventId: string | null,
  triggerCommitSha: string | null,
): GitSourceSyncTaskRequest {
  return {
    adoptionMode: 'incremental',
    kind,
    requestedByPrincipalId,
    requestedDescriptorPaths,
    triggerCommitSha,
    triggerSourceEventId,
  };
}
