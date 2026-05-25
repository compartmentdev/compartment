import type { SourceSyncTaskCandidateRow, SourceSyncTaskRow } from '../../queries/source-sync.query.types';
import { readGitSourceJsonStringArray } from './git-source-json.support';
import type { GitSourceSyncCandidateView, GitSourceSyncTaskView } from './git-source-sync.service.types';

export function buildGitSourceSyncTaskView(
  task: SourceSyncTaskRow,
  candidates: readonly SourceSyncTaskCandidateRow[],
): GitSourceSyncTaskView {
  return {
    candidates: candidates.map(buildGitSourceSyncCandidateView),
    failureReason: task.failureReason,
    id: task.id,
    requestedBranchName: task.requestedBranchName,
    resolvedCommitSha: task.resolvedCommitSha,
    status: task.status,
  };
}

function buildGitSourceSyncCandidateView(candidate: SourceSyncTaskCandidateRow): GitSourceSyncCandidateView {
  return {
    blockedReason: candidate.blockedReason,
    derivedWatchPaths: readDerivedWatchPaths(candidate),
    descriptorDirectory: candidate.descriptorDirectory,
    descriptorPath: candidate.descriptorPath,
    id: candidate.id,
    projectName: candidate.projectName,
    status: candidate.status,
  };
}

function readDerivedWatchPaths(candidate: SourceSyncTaskCandidateRow): string[] {
  return readGitSourceJsonStringArray(candidate.derivedWatchPathsJson);
}
