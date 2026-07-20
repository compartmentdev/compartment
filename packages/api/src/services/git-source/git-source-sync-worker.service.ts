import type {
  WorkerClaimedGitSourceSyncTask,
  WorkerFailGitSourceSyncTaskRequest,
  WorkerCompleteGitSourceSyncTaskRequest,
} from '@compartment/contracts';
import { decryptVariableValueFromStorage } from '../../lib/variables-crypto';
import { createId } from '../../lib/tokens';
import { sourceSyncTaskLeaseMs } from '../../git-source.constants';
import { findGitProviderRegistrationById } from '../../queries/git-provider-registration.query';
import type { GitProviderRegistrationRow } from '../../queries/git-provider-registration.query.types';
import { createSourceSyncClaimToken } from '../../queries/source-sync-claim-token.query.support';
import {
  cancelNonTerminalSourceSyncTasksBySource,
  claimNextSourceSyncTask,
  failSourceSyncTask,
  findSourceSyncTaskById,
  retrySourceSyncTask,
} from '../../queries/source-sync.query';
import type { SourceSyncTaskRow } from '../../queries/source-sync.query.types';
import { findSourceById } from '../../queries/source.query';
import type { SourceMutationTransaction, SourceRow } from '../../queries/source.query.types';
import { getApiConfig, getApiDatabase } from '../../runtime/runtime-access';
import { recordAuditEvent, writeCommittedAuditEventsToLocalFileSink } from '../audit-events.service';
import type { AuditEventResult } from '../audit-events.service.types';
import { invalidateResourceLogProjectSnapshot } from '../deployment-product-logs.service';
import { mintGitHubInstallationToken, type GitHubInstallationTokenInput } from './github-app-http.adapter';
import { completeClaimedGitSourceSyncTask } from './git-source-sync-completion.service';
import type { CompleteClaimedGitSourceSyncTaskResult } from './git-source-sync-completion.service.types';
import { buildGitSourceSyncAuditEventInput } from './git-source-audit.service';
import {
  requireActiveSource,
  requireEncryptedRegistrationField,
  requireGitProviderRegistration,
} from './git-source-resolution-worker.support';

const sourceSyncCanceledFailureReason: string = 'Source is no longer active for sync completion.';

interface CompleteSourceSyncTransactionResult {
  auditEvents: AuditEventResult[];
  projectSnapshotInvalidationRequired: boolean;
}

export async function claimGitSourceSyncTaskForWorker(): Promise<WorkerClaimedGitSourceSyncTask | null> {
  const now: Date = new Date();
  const task: SourceSyncTaskRow | null = await claimNextSourceSyncTask(
    createId('wrk'),
    now,
    new Date(now.getTime() + sourceSyncTaskLeaseMs),
  );

  return task === null ? null : await buildClaimedSourceSyncTask(task);
}

export async function completeGitSourceSyncTaskForWorker(input: WorkerCompleteGitSourceSyncTaskRequest): Promise<void> {
  const task: SourceSyncTaskRow = requireSourceSyncTask(await findSourceSyncTaskById(input.taskId));
  if (isTerminalSourceSyncTaskStatus(task.status)) {
    return;
  }

  const source: SourceRow | undefined = await findSourceById(task.sourceId);
  if (source?.status !== 'active') {
    await cancelSourceSyncTasksForInactiveSource(task.sourceId);
    return;
  }

  await completeClaimedSourceSyncTaskAndRecordAudit(task, source, input);
}

export async function failGitSourceSyncTaskForWorker(input: WorkerFailGitSourceSyncTaskRequest): Promise<void> {
  const task: SourceSyncTaskRow = requireSourceSyncTask(await findSourceSyncTaskById(input.taskId));
  if (isTerminalSourceSyncTaskStatus(task.status)) {
    return;
  }

  if (task.attemptCount >= task.maxAttempts) {
    await failSourceSyncTaskAndRecordAudit(task, input);
    return;
  }

  await retrySourceSyncTask(getApiDatabase(), {
    claimToken: input.claimToken,
    failureReason: input.failureReason,
    id: task.id,
    updatedAt: new Date(),
  });
}

async function completeClaimedSourceSyncTaskAndRecordAudit(
  task: SourceSyncTaskRow,
  source: SourceRow,
  input: WorkerCompleteGitSourceSyncTaskRequest,
): Promise<void> {
  const now: Date = new Date();
  const result: CompleteSourceSyncTransactionResult = await getApiDatabase().transaction(
    async (transaction: SourceMutationTransaction): Promise<CompleteSourceSyncTransactionResult> =>
      await completeClaimedSourceSyncTaskAndBuildResult(transaction, task, source, input, now),
  );
  if (result.projectSnapshotInvalidationRequired) {
    invalidateResourceLogProjectSnapshot();
  }
  writeCommittedAuditEventsToLocalFileSink(result.auditEvents);
}

async function completeClaimedSourceSyncTaskAndBuildResult(
  transaction: SourceMutationTransaction,
  task: SourceSyncTaskRow,
  source: SourceRow,
  input: WorkerCompleteGitSourceSyncTaskRequest,
  now: Date,
): Promise<CompleteSourceSyncTransactionResult> {
  const result: CompleteClaimedGitSourceSyncTaskResult | null = await completeClaimedGitSourceSyncTask(
    transaction,
    task,
    source,
    input,
    now,
  );
  if (result === null) {
    return { auditEvents: [], projectSnapshotInvalidationRequired: false };
  }

  return {
    auditEvents: [
      ...result.auditEvents,
      await recordSucceededSourceSyncAuditEvent(transaction, source, result.completedTask, input.resolvedCommitSha),
    ],
    projectSnapshotInvalidationRequired: result.projectSnapshotInvalidationRequired,
  };
}

async function failSourceSyncTaskAndRecordAudit(
  task: SourceSyncTaskRow,
  input: WorkerFailGitSourceSyncTaskRequest,
): Promise<void> {
  const source: SourceRow | undefined = await findSourceById(task.sourceId);
  const auditEvents: AuditEventResult[] = await getApiDatabase().transaction(
    async (transaction: SourceMutationTransaction): Promise<AuditEventResult[]> =>
      await failSourceSyncTaskAndBuildAuditEvents(transaction, task, input, source),
  );
  writeCommittedAuditEventsToLocalFileSink(auditEvents);
}

async function failSourceSyncTaskAndBuildAuditEvents(
  transaction: SourceMutationTransaction,
  task: SourceSyncTaskRow,
  input: WorkerFailGitSourceSyncTaskRequest,
  source: SourceRow | undefined,
): Promise<AuditEventResult[]> {
  const now: Date = new Date();
  const failedTask: SourceSyncTaskRow | null = await failSourceSyncTask(transaction, {
    claimToken: input.claimToken,
    completedAt: now,
    failureReason: input.failureReason,
    id: task.id,
    updatedAt: now,
  });
  if (failedTask === null || source === undefined) {
    return [];
  }

  return [await recordFailedSourceSyncAuditEvent(transaction, source, failedTask)];
}

async function recordSucceededSourceSyncAuditEvent(
  executor: SourceMutationTransaction,
  source: SourceRow,
  task: SourceSyncTaskRow,
  resolvedCommitSha: string,
): Promise<AuditEventResult> {
  return await recordAuditEvent(
    buildGitSourceSyncAuditEventInput({
      executor,
      resolvedCommitSha,
      source,
      status: 'succeeded',
      task,
    }),
  );
}

async function recordFailedSourceSyncAuditEvent(
  executor: SourceMutationTransaction,
  source: SourceRow,
  task: SourceSyncTaskRow,
): Promise<AuditEventResult> {
  return await recordAuditEvent(
    buildGitSourceSyncAuditEventInput({
      executor,
      source,
      status: 'failed',
      task,
    }),
  );
}

async function cancelSourceSyncTasksForInactiveSource(sourceId: string): Promise<void> {
  const now: Date = new Date();
  await cancelNonTerminalSourceSyncTasksBySource(getApiDatabase(), {
    completedAt: now,
    failureReason: sourceSyncCanceledFailureReason,
    sourceId,
    updatedAt: now,
  });
}

async function buildClaimedSourceSyncTask(task: SourceSyncTaskRow): Promise<WorkerClaimedGitSourceSyncTask> {
  const source: SourceRow = requireActiveSource(await findSourceById(task.sourceId));
  const registration: GitProviderRegistrationRow = requireGitProviderRegistration(
    await findGitProviderRegistrationById({
      organizationId: source.organizationId,
      registrationId: source.providerRegistrationId,
    }),
  );

  return {
    claimToken: createSourceSyncClaimToken({
      claimedAt: requireClaimedAt(task.claimedAt),
      claimedByWorkerId: requireClaimedByWorkerId(task.claimedByWorkerId),
      secret: getApiConfig().runtimeControlToken,
    }),
    installationToken: await mintGitHubInstallationToken(buildGitHubInstallationTokenInput(source, registration)),
    providerHost: source.providerHost,
    repositoryName: source.repositoryName,
    repositoryOwner: source.repositoryOwner,
    requestedBranchName: task.requestedBranchName,
    sourceId: source.id,
    taskId: task.id,
    triggerCommitSha: task.triggerCommitSha,
  };
}

function buildGitHubInstallationTokenInput(
  source: SourceRow,
  registration: GitProviderRegistrationRow,
): GitHubInstallationTokenInput {
  return {
    appId: requireEncryptedRegistrationField(registration.appId, 'app_id'),
    installationId: source.providerInstallationId,
    privateKeyPem: decryptVariableValueFromStorage(
      requireEncryptedRegistrationField(registration.privateKeyPemCiphertext, 'private_key_pem_ciphertext'),
      requireEncryptedRegistrationField(registration.privateKeyPemEncryptionKeyId, 'private_key_pem_encryption_key_id'),
      getApiConfig().variablesMasterKey,
    ),
    providerHost: source.providerHost,
  };
}

function isTerminalSourceSyncTaskStatus(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'canceled';
}

function requireClaimedAt(claimedAt: Date | null): Date {
  if (claimedAt === null) {
    throw new Error('Source sync task claim timestamp was not recorded.');
  }

  return claimedAt;
}

function requireClaimedByWorkerId(claimedByWorkerId: string | null): string {
  if (claimedByWorkerId === null) {
    throw new Error('Source sync task claim worker was not recorded.');
  }

  return claimedByWorkerId;
}

function requireSourceSyncTask(task: SourceSyncTaskRow | undefined): SourceSyncTaskRow {
  if (task === undefined) {
    throw new Error('Source sync task was not found.');
  }

  return task;
}
