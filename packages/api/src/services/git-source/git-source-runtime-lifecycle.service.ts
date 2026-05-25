import { getApiDatabase } from '../../runtime/runtime-access';
import {
  cancelNonTerminalSourceResolutionTasksBySource,
  listNonTerminalSourceResolutionTaskEventIdsBySourceIds,
  listNonTerminalSourceResolutionTaskEventIdsWithExecutor,
  updateSourceEventStatus,
} from '../../queries/source-resolution.query';
import { cancelNonTerminalSourceSyncTasksBySource } from '../../queries/source-sync.query';
import type { SourceResolutionMutationTransaction } from '../../queries/source-resolution.query.types';
import {
  listActiveSourcesByProviderInstallation,
  listActiveSourcesByProviderRepository,
  updateSourceToDisabled,
} from '../../queries/source.query';
import type { GitProviderRegistrationRow } from '../../queries/git-provider-registration.query.types';
import type { SourceRow } from '../../queries/source.query.types';
import {
  readInstallationWebhookInstallationId,
  readRepositoryExternalId,
  readRepositoryOwner,
  requireGitHubInstallationWebhookPayload,
  validateRepositoryOwnerMatch,
} from './git-source-runtime.support';
import { blockSourceAutomationPrincipalAccessWithExecutor } from './git-source-automation-principal.service';
import type {
  GitHubInstallationWebhookPayload,
  GitHubRepositoryWebhookPayload,
  GitHubWebhookObject,
} from './git-source-runtime.service.types';

const sourceDisabledFailureReason: string = 'Git provider access was removed for this source.';

export async function handleGitHubInstallationWebhook(
  registration: GitProviderRegistrationRow,
  body: GitHubWebhookObject,
): Promise<void> {
  const payload: GitHubInstallationWebhookPayload = requireGitHubInstallationWebhookPayload(body);
  if (payload.action !== 'deleted' && payload.action !== 'suspend') {
    return;
  }

  await disableSourcesForLostProviderAccess(
    await listActiveSourcesByProviderInstallation(
      registration.organizationId,
      registration.id,
      readInstallationWebhookInstallationId(payload),
      registration.providerHost,
    ),
  );
}

export async function handleGitHubInstallationRepositoriesWebhook(
  registration: GitProviderRegistrationRow,
  body: GitHubWebhookObject,
): Promise<void> {
  const payload: GitHubInstallationWebhookPayload = requireGitHubInstallationWebhookPayload(body);
  const removedRepositories: readonly GitHubRepositoryWebhookPayload[] = payload.repositories_removed ?? [];
  if (payload.action !== 'removed' || removedRepositories.length === 0) {
    return;
  }

  await disableSourcesForLostProviderAccess(
    deduplicateSources(
      await listRemovedRepositorySources(
        registration,
        readInstallationWebhookInstallationId(payload),
        removedRepositories,
      ),
    ),
  );
}

async function listRemovedRepositorySources(
  registration: GitProviderRegistrationRow,
  installationId: string,
  repositories: readonly GitHubRepositoryWebhookPayload[],
): Promise<SourceRow[]> {
  const sources: SourceRow[] = [];

  for (const repository of repositories) {
    validateRepositoryOwnerMatch(registration, readRepositoryOwner(repository));
    sources.push(
      ...(await listActiveSourcesByProviderRepository(
        registration.organizationId,
        registration.id,
        installationId,
        registration.providerHost,
        readRepositoryExternalId(repository),
      )),
    );
  }

  return sources;
}

async function disableSourcesForLostProviderAccess(sources: readonly SourceRow[]): Promise<void> {
  if (sources.length === 0) {
    return;
  }

  const sourceIds: string[] = sources.map((source: SourceRow): string => source.id);
  const maybeCompletedEventIds: string[] = await listNonTerminalSourceResolutionTaskEventIdsBySourceIds(sourceIds);
  const now: Date = new Date();

  await getApiDatabase().transaction(async (tx: SourceResolutionMutationTransaction): Promise<void> => {
    for (const source of sources) {
      await disableSourceForLostProviderAccess(tx, source, now);
    }

    await completeTerminalSourceEvents(tx, maybeCompletedEventIds, now);
  });
}

async function disableSourceForLostProviderAccess(
  tx: SourceResolutionMutationTransaction,
  source: SourceRow,
  now: Date,
): Promise<void> {
  await blockSourceAutomationPrincipalAccessWithExecutor(tx, source, now);
  await updateSourceToDisabled(tx, {
    sourceId: source.id,
    updatedAt: now,
  });
  await cancelNonTerminalSourceResolutionTasksBySource(tx, {
    completedAt: now,
    failureReason: sourceDisabledFailureReason,
    sourceId: source.id,
    updatedAt: now,
  });
  await cancelNonTerminalSourceSyncTasksBySource(tx, {
    completedAt: now,
    failureReason: sourceDisabledFailureReason,
    sourceId: source.id,
    updatedAt: now,
  });
}

async function completeTerminalSourceEvents(
  tx: SourceResolutionMutationTransaction,
  maybeCompletedEventIds: readonly string[],
  now: Date,
): Promise<void> {
  const liveEventIds: Set<string> = new Set<string>(
    await listNonTerminalSourceResolutionTaskEventIdsWithExecutor(tx, maybeCompletedEventIds),
  );

  for (const sourceEventId of maybeCompletedEventIds) {
    if (liveEventIds.has(sourceEventId)) {
      continue;
    }

    await updateSourceEventStatus(tx, {
      completedAt: now,
      sourceEventId,
      status: 'completed',
      updatedAt: now,
    });
  }
}

function deduplicateSources(sources: readonly SourceRow[]): SourceRow[] {
  const sourcesById: Map<string, SourceRow> = new Map<string, SourceRow>();

  for (const source of sources) {
    sourcesById.set(source.id, source);
  }

  return [...sourcesById.values()];
}
