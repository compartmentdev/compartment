import {
  readGitSourceDescriptorProjectMismatchMessage,
  readGitSourceDescriptorDirectory,
  type GitSourceBindingInput,
  type WorkerCompletedGitSourceSyncCandidate,
} from '@compartment/contracts';
import { hasText } from '@compartment/utils';
import { isApiBusinessError } from '../../errors/api-business-error';
import { createId } from '../../lib/tokens';
import { isUniqueConstraintError } from '../../queries/query-error';
import type { SourceBindingRow, SourceRow } from '../../queries/source.query.types';
import type { CreateSourceSyncTaskCandidateInput, SourceSyncTaskRow } from '../../queries/source-sync.query.types';
import type { AdoptGitSourceBindingInput } from './git-source-binding-adoption.service';
import { readReservedDisconnectedProjectBlockedReason } from './git-source-sync-candidate-migration.service';
import { readGitSourceJsonStringArray } from './git-source-json.support';
import { readKnownConnectConflictMessage } from './git-source.service.support';

const missingProjectNameBlockedReason: string = 'Descriptor did not resolve a project name.';
const missingRequestedDescriptorBlockedReason: string = 'Descriptor was not found on the sync branch.';

export interface PersistedSourceSyncCandidateContext {
  activeBindingsByDescriptorPath: ReadonlyMap<string, SourceBindingRow>;
  completedCandidateCountsByProjectName: ReadonlyMap<string, number>;
  disconnectedBindingsByDescriptorPath: ReadonlyMap<string, SourceBindingRow>;
  disconnectedBindingCountsByProjectName: ReadonlyMap<string, number>;
  disconnectedBindingsByProjectName: ReadonlyMap<string, SourceBindingRow>;
  discoveredDescriptorPaths: ReadonlySet<string>;
  excludedDescriptorPaths: Set<string>;
  requestedDescriptorPaths: Set<string>;
  sourceAutoAdoptNewApps: boolean;
  taskAdoptionMode: string;
}

export function buildSourceSyncBindingAdoptionInput(
  task: SourceSyncTaskRow,
  source: SourceRow,
  candidate: WorkerCompletedGitSourceSyncCandidate,
  projectName: string,
  movedSourceBindingId: string | null,
): AdoptGitSourceBindingInput {
  return {
    actorPrincipalId: task.requestedByPrincipalId,
    binding: buildAutoAdoptBindingRequest(task, source, candidate.descriptorPath, projectName),
    ...(movedSourceBindingId !== null ? { movedSourceBindingId } : {}),
    organizationId: source.organizationId,
    sourceId: source.id,
    watchPathsJson: JSON.stringify(candidate.derivedWatchPaths),
  };
}

export function readPersistedSourceSyncCandidate(
  taskId: string,
  candidate: WorkerCompletedGitSourceSyncCandidate,
  context: PersistedSourceSyncCandidateContext,
  now: Date,
): CreateSourceSyncTaskCandidateInput | null | undefined {
  const knownBindingCandidate: CreateSourceSyncTaskCandidateInput | null | undefined = readKnownBindingCandidate(
    taskId,
    candidate,
    context,
    now,
  );
  if (knownBindingCandidate !== undefined) {
    return knownBindingCandidate;
  }

  const blockedReason: string | null = readBlockedCandidateReason(candidate);
  if (blockedReason !== null) {
    return buildSourceSyncCandidateInput(taskId, candidate, 'blocked', blockedReason, now);
  }
  return readUnboundPersistedSourceSyncCandidate(taskId, candidate, context, now);
}

export function readCandidateAdoptionBlockedReason(error: Error | null | undefined): string | null {
  if (error !== null && error !== undefined && isUniqueConstraintError(error)) {
    return readKnownConnectConflictMessage(error) ?? 'The descriptor conflicts with an existing Git binding.';
  }
  if (error !== null && error !== undefined && isApiBusinessError(error) && error.code === 'git_source_conflict') {
    return error.message;
  }

  return null;
}

export function readRequestedDescriptorPaths(value: string): Set<string> {
  return new Set<string>(readGitSourceJsonStringArray(value));
}

function buildAutoAdoptBindingRequest(
  task: SourceSyncTaskRow,
  source: SourceRow,
  descriptorPath: string,
  projectName: string,
): GitSourceBindingInput {
  return {
    autoDeployEnabled: source.defaultAutoDeployEnabled,
    branchMapping: {
      branchName: task.requestedBranchName,
      environmentName: source.defaultEnvironmentName,
    },
    descriptorPath,
    projectName,
  };
}

function readKnownBindingCandidate(
  taskId: string,
  candidate: WorkerCompletedGitSourceSyncCandidate,
  context: PersistedSourceSyncCandidateContext,
  now: Date,
): CreateSourceSyncTaskCandidateInput | null | undefined {
  if (context.excludedDescriptorPaths.has(candidate.descriptorPath)) {
    return null;
  }

  const activeBinding: SourceBindingRow | undefined = context.activeBindingsByDescriptorPath.get(
    candidate.descriptorPath,
  );
  if (activeBinding !== undefined) {
    return readActiveBindingCandidate(taskId, candidate, activeBinding, context, now);
  }

  const disconnectedBinding: SourceBindingRow | undefined = context.disconnectedBindingsByDescriptorPath.get(
    candidate.descriptorPath,
  );
  return disconnectedBinding === undefined
    ? undefined
    : readDisconnectedBindingCandidate(taskId, candidate, disconnectedBinding, now);
}

function readBlockedCandidateReason(candidate: WorkerCompletedGitSourceSyncCandidate): string | null {
  return candidate.blockedReason ?? readMissingProjectNameBlockedReason(candidate.projectName);
}

function readUnboundPersistedSourceSyncCandidate(
  taskId: string,
  candidate: WorkerCompletedGitSourceSyncCandidate,
  context: PersistedSourceSyncCandidateContext,
  now: Date,
): CreateSourceSyncTaskCandidateInput | null | undefined {
  const reservedDisconnectedProjectBlockedReason: string | null = readReservedDisconnectedProjectBlockedReason(
    candidate,
    context,
  );
  if (reservedDisconnectedProjectBlockedReason !== null) {
    return buildSourceSyncCandidateInput(taskId, candidate, 'blocked', reservedDisconnectedProjectBlockedReason, now);
  }

  return shouldAdoptUnboundCandidate(candidate, context) ? undefined : null;
}

function readActiveBindingCandidate(
  taskId: string,
  candidate: WorkerCompletedGitSourceSyncCandidate,
  binding: SourceBindingRow,
  context: PersistedSourceSyncCandidateContext,
  now: Date,
): CreateSourceSyncTaskCandidateInput | null {
  const blockedReason: string | null = readBindingCandidateBlockedReason(candidate, binding.projectName);
  if (blockedReason !== null) {
    return buildSourceSyncCandidateInput(taskId, candidate, 'blocked', blockedReason, now);
  }

  return context.requestedDescriptorPaths.has(candidate.descriptorPath)
    ? buildSourceSyncCandidateInput(taskId, candidate, 'accepted', null, now)
    : null;
}

function readDisconnectedBindingCandidate(
  taskId: string,
  candidate: WorkerCompletedGitSourceSyncCandidate,
  binding: SourceBindingRow,
  now: Date,
): CreateSourceSyncTaskCandidateInput | undefined {
  const blockedReason: string | null = readBindingCandidateBlockedReason(candidate, binding.projectName);
  return blockedReason === null
    ? undefined
    : buildSourceSyncCandidateInput(taskId, candidate, 'blocked', blockedReason, now);
}

export function buildSourceSyncCandidateInput(
  taskId: string,
  candidate: WorkerCompletedGitSourceSyncCandidate,
  status: 'accepted' | 'blocked',
  blockedReason: string | null,
  now: Date,
): CreateSourceSyncTaskCandidateInput {
  return {
    blockedReason,
    derivedWatchPathsJson: JSON.stringify(candidate.derivedWatchPaths),
    descriptorDirectory: candidate.descriptorDirectory,
    descriptorPath: candidate.descriptorPath,
    id: createId('ssc'),
    projectName: candidate.projectName,
    sourceSyncTaskId: taskId,
    status,
    updatedAt: now,
  };
}

export function buildMissingSourceSyncCandidateInput(
  taskId: string,
  descriptorPath: string,
  projectName: string | null,
  now: Date,
): CreateSourceSyncTaskCandidateInput {
  return {
    blockedReason: missingRequestedDescriptorBlockedReason,
    derivedWatchPathsJson: '[]',
    descriptorDirectory: readGitSourceDescriptorDirectory(descriptorPath),
    descriptorPath,
    id: createId('ssc'),
    projectName,
    sourceSyncTaskId: taskId,
    status: 'blocked',
    updatedAt: now,
  };
}

export function readBindingCandidateBlockedReason(
  candidate: WorkerCompletedGitSourceSyncCandidate,
  expectedProjectName: string,
): string | null {
  if (candidate.blockedReason !== null) {
    return candidate.blockedReason;
  }

  const missingProjectBlockedReason: string | null = readMissingProjectNameBlockedReason(candidate.projectName);
  if (missingProjectBlockedReason !== null) {
    return missingProjectBlockedReason;
  }

  const actualProjectName: string = requireCandidateProjectName(candidate.projectName);
  return actualProjectName === expectedProjectName
    ? null
    : readGitSourceDescriptorProjectMismatchMessage(candidate.descriptorPath, actualProjectName, expectedProjectName);
}

function readMissingProjectNameBlockedReason(projectName: string | null): string | null {
  return hasText(projectName) ? null : missingProjectNameBlockedReason;
}

export function requireCandidateProjectName(projectName: string | null): string {
  if (!hasText(projectName)) {
    throw new Error(missingProjectNameBlockedReason);
  }

  return projectName;
}

function shouldAdoptUnboundCandidate(
  candidate: WorkerCompletedGitSourceSyncCandidate,
  context: PersistedSourceSyncCandidateContext,
): boolean {
  return (
    context.taskAdoptionMode === 'bootstrap' ||
    context.requestedDescriptorPaths.has(candidate.descriptorPath) ||
    context.sourceAutoAdoptNewApps
  );
}
