import type { GitSourceSyncCandidate, GitSourceSyncTask } from '@compartment/contracts';
import { getGitSourceSyncTask } from '../../services/sources.service';
import type { AuthenticatedContext } from '../../services/context.types';
import { pollSourceCommandValue } from './source.command.helpers';

export async function waitForGitSourceSyncTask(
  context: AuthenticatedContext,
  sourceId: string,
  initialTask: GitSourceSyncTask,
): Promise<GitSourceSyncTask> {
  if (initialTask.status === 'completed' || initialTask.status === 'failed' || initialTask.status === 'canceled') {
    return initialTask;
  }

  return await pollSourceCommandValue<GitSourceSyncTask>({
    isTerminal: (task: GitSourceSyncTask): boolean =>
      task.status === 'completed' || task.status === 'failed' || task.status === 'canceled',
    readValue: async (): Promise<GitSourceSyncTask> =>
      (await getGitSourceSyncTask(context, sourceId, initialTask.id)).task,
    timeoutMessage: `Timed out waiting for source sync task ${initialTask.id}.`,
  });
}

export function createCompletedGitSourceSyncMessage(sourceId: string, task: GitSourceSyncTask): string {
  const acceptedCandidates: GitSourceSyncCandidate[] = readAcceptedCandidates(task);
  const blockedCandidates: GitSourceSyncCandidate[] = readBlockedCandidates(task);
  const lines: string[] = [
    `Completed source sync ${task.id} for ${sourceId}.`,
    `Branch: ${task.requestedBranchName}`,
    `Resolved commit: ${task.resolvedCommitSha ?? 'unknown'}`,
    `Accepted apps: ${acceptedCandidates.length}`,
    `Blocked apps: ${blockedCandidates.length}`,
  ];

  if (acceptedCandidates.length > 0) {
    lines.push('Accepted:');
    lines.push(...acceptedCandidates.map(formatAcceptedCandidateLine));
  }

  if (blockedCandidates.length > 0) {
    lines.push('Blocked:');
    lines.push(...blockedCandidates.map(formatBlockedCandidateLine));
  }

  return lines.join('\n');
}

export function readTerminalSyncFailureMessage(sourceId: string, task: GitSourceSyncTask): string {
  return task.failureReason === null
    ? `Source sync ${task.id} for ${sourceId} ended with status ${task.status}.`
    : `Source sync ${task.id} for ${sourceId} failed: ${task.failureReason}`;
}

function readAcceptedCandidates(task: GitSourceSyncTask): GitSourceSyncCandidate[] {
  return task.candidates.filter((candidate: GitSourceSyncCandidate): boolean => candidate.status === 'accepted');
}

function readBlockedCandidates(task: GitSourceSyncTask): GitSourceSyncCandidate[] {
  return task.candidates.filter((candidate: GitSourceSyncCandidate): boolean => candidate.status === 'blocked');
}

function formatAcceptedCandidateLine(candidate: GitSourceSyncCandidate): string {
  return `- ${candidate.descriptorPath}\t${candidate.projectName ?? 'unknown project'}`;
}

function formatBlockedCandidateLine(candidate: GitSourceSyncCandidate): string {
  return `- ${candidate.descriptorPath}\t${candidate.projectName ?? 'unknown project'}\t${candidate.blockedReason ?? 'Blocked.'}`;
}
