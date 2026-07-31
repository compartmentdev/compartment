import { createGitSourceRequestInvalidError } from '../../errors/api-business-error';
import { findGitProviderRegistrationByWebhookTarget } from '../../queries/git-provider-registration.query';
import type { GitProviderRegistrationRow } from '../../queries/git-provider-registration.query.types';
import { listActiveSourcesByProviderRepository } from '../../queries/source.query';
import type { SourceRow } from '../../queries/source.query.types';
import type { HandleGitLabSourceWebhookInput } from './gitlab-source-webhook.service.types';
import { parseGitLabPushPayload, verifyGitLabWebhookToken } from './gitlab-webhook.adapter';
import type { ParsedGitLabPush } from './gitlab-webhook.adapter.types';
import { persistNormalizedGitSourcePush } from './git-source-runtime-push.service';

export async function handleGitLabSourceWebhook(input: HandleGitLabSourceWebhookInput): Promise<void> {
  const registration: GitProviderRegistrationRow = requireRegistration(
    await findGitProviderRegistrationByWebhookTarget({
      organizationId: input.organizationId,
      registrationId: input.registrationId,
    }),
  );
  verifyGitLabWebhookToken(registration, input.token);
  if (input.eventType !== 'Push Hook') return;
  const push: ParsedGitLabPush | null = parseGitLabPushPayload(input.body);
  if (push === null) return;
  const sources: SourceRow[] = await readGitLabPushSources(registration, push.repositoryExternalId);
  if (sources.length === 0) return;
  await persistNormalizedGitSourcePush(input, sources, {
    branchName: push.branchName,
    changedFilesState: { changedFiles: push.changedFiles, changedFilesComplete: push.changedFilesComplete },
    commitSha: push.commitSha,
    payloadJson: JSON.stringify(input.body),
  });
}

async function readGitLabPushSources(
  registration: GitProviderRegistrationRow,
  repositoryExternalId: string,
): Promise<SourceRow[]> {
  return await listActiveSourcesByProviderRepository(
    registration.organizationId,
    registration.id,
    null,
    registration.providerHost,
    repositoryExternalId,
  );
}

function requireRegistration(registration: GitProviderRegistrationRow | undefined): GitProviderRegistrationRow {
  if (registration?.providerType !== 'gitlab')
    throw createGitSourceRequestInvalidError('GitLab provider registration was not found for the webhook request.');
  return registration;
}
