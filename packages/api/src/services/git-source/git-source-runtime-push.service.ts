import { getApiDatabase } from '../../runtime/runtime-access';
import type { SourceResolutionMutationTransaction } from '../../queries/source-resolution.query.types';
import { listActiveSourcesByProviderRepository } from '../../queries/source.query';
import type { GitProviderRegistrationRow } from '../../queries/git-provider-registration.query.types';
import type { SourceRow } from '../../queries/source.query.types';
import { recordAuditEvent, writeCommittedAuditEventsToLocalFileSink } from '../audit-events.service';
import type { AuditEventResult } from '../audit-events.service.types';
import {
  readChangedFiles,
  readPushBranchName,
  readPushInstallationId,
  readRepositoryExternalId,
  readRepositoryOwner,
  requireGitHubPushWebhookPayload,
  validateRepositoryOwnerMatch,
} from './git-source-runtime.support';
import { buildGitSourcePushAuditEventInputs } from './git-source-audit.service';
import type { BuildGitSourcePushAuditEventInputsInput } from './git-source-audit.service.types';
import { persistSourcePushEventsForAudit } from './git-source-runtime-push-persistence.service';
import type {
  GitHubPushWebhookPayload,
  HandleGitHubSourceWebhookInput,
  PushChangedFilesState,
} from './git-source-runtime.service.types';

export async function handleGitHubPushWebhook(
  registration: GitProviderRegistrationRow,
  input: HandleGitHubSourceWebhookInput,
): Promise<void> {
  const payload: GitHubPushWebhookPayload = requireGitHubPushWebhookPayload(input.body);
  if (payload.deleted === true) {
    return;
  }

  const branchName: string | null = readPushBranchName(payload);
  if (branchName === null) {
    return;
  }

  const sources: SourceRow[] = await readMatchedPushSources(registration, payload);
  if (sources.length === 0) {
    return;
  }

  await persistPushSourceEvents(input, payload, sources, branchName, readChangedFiles(payload));
}

async function readMatchedPushSources(
  registration: GitProviderRegistrationRow,
  payload: GitHubPushWebhookPayload,
): Promise<SourceRow[]> {
  validateRepositoryOwnerMatch(registration, readRepositoryOwner(payload.repository));

  return await listActiveSourcesByProviderRepository(
    registration.organizationId,
    registration.id,
    readPushInstallationId(payload),
    registration.providerHost,
    readRepositoryExternalId(payload.repository),
  );
}

async function persistPushSourceEvents(
  input: HandleGitHubSourceWebhookInput,
  payload: GitHubPushWebhookPayload,
  sources: readonly SourceRow[],
  branchName: string,
  changedFilesState: PushChangedFilesState,
): Promise<void> {
  const recordedAuditEvents: AuditEventResult[] = await getApiDatabase().transaction(
    async (tx: SourceResolutionMutationTransaction): Promise<AuditEventResult[]> =>
      await recordPushAuditEventsInTransaction(tx, input, payload, sources, branchName, changedFilesState),
  );
  writeCommittedAuditEventsToLocalFileSink(recordedAuditEvents);
}

async function recordPushAuditEventsInTransaction(
  tx: SourceResolutionMutationTransaction,
  input: HandleGitHubSourceWebhookInput,
  payload: GitHubPushWebhookPayload,
  sources: readonly SourceRow[],
  branchName: string,
  changedFilesState: PushChangedFilesState,
): Promise<AuditEventResult[]> {
  const auditEventResults: AuditEventResult[] = [];
  const auditEvents: BuildGitSourcePushAuditEventInputsInput[] = await persistSourcePushEventsForAudit(tx, input, {
    branchName,
    changedFilesState,
    commitSha: payload.after,
    payloadJson: JSON.stringify(payload),
    sources,
  });
  for (const auditEvent of auditEvents) {
    for (const auditEventInput of buildGitSourcePushAuditEventInputs({ ...auditEvent, executor: tx })) {
      auditEventResults.push(await recordAuditEvent(auditEventInput));
    }
  }
  return auditEventResults;
}
