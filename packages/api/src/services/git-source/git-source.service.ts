import {
  createGitSourceConflictError,
  createGitSourceRepositoryAccessDeniedError,
} from '../../errors/api-business-error';
import { isUniqueConstraintError } from '../../queries/query-error';
import {
  disconnectBindingsBySource,
  disconnectSource,
  findActiveSourceByRepository,
  listConnectedSourcesByOrganization,
} from '../../queries/source.query';
import { cancelNonTerminalSourceResolutionTasksBySource } from '../../queries/source-resolution.query';
import { cancelNonTerminalSourceSyncTasksBySource } from '../../queries/source-sync.query';
import type { SourceMutationTransaction, SourceRow } from '../../queries/source.query.types';
import { getApiDatabase } from '../../runtime/runtime-access';
import { type ResolvedRepositoryAccess } from './git-source-connect.validation';
import { persistConnectedGitSource, type PersistConnectedGitSourceInput } from './git-source-connect.persistence';
import {
  blockSourceAutomationPrincipalAccessWithExecutor,
  ensureSourceAutomationPrincipalWithExecutor,
} from './git-source-automation-principal.service';
import {
  readKnownConnectConflictMessage,
  requireActiveConnectedSource,
  requireConnectedSource,
} from './git-source.service.support';
import { connectExistingGitSource } from './git-source-existing-connection.service';
import { requireActiveGitProviderAccess } from './git-source-provider-access.service';
import { getGitProviderAdapter } from './git-source-provider.registry';
import type {
  GitProviderAccess,
  GitProviderAdapter,
  GitRepositoryMetadata,
  GitRepositoryRef,
} from './git-source-provider.types';
import { buildGitSourceSummary, buildGitSourceView } from './git-source-view.service';
import type {
  ConnectGitSourceInput,
  ConnectGitSourceResult,
  DisconnectGitSourceInput,
  GitSourceContextInput,
  GitSourceListItem,
  GitSourceRepositoryRequest,
  GitSourceView,
} from './git-source.service.types';
import { queueGitSourceSyncTaskForConnect } from './git-source-sync-task.service';

const disconnectGitSourceFailureReason: string = 'Git source was disconnected.';

interface ResolvedConnectRepository {
  repository: GitRepositoryMetadata;
  repositoryAccess: ResolvedRepositoryAccess;
}

export async function listGitSources(input: GitSourceContextInput): Promise<GitSourceListItem[]> {
  return (await listConnectedSourcesByOrganization(input.organizationId)).map(
    (source: SourceRow): GitSourceListItem => ({
      source: buildGitSourceSummary(source),
    }),
  );
}
export async function readGitSource(input: DisconnectGitSourceInput): Promise<GitSourceView> {
  return await buildGitSourceView(await requireConnectedSource(input));
}
export async function connectGitSource(input: ConnectGitSourceInput): Promise<ConnectGitSourceResult> {
  const resolved: ResolvedConnectRepository = await resolveConnectRepository(input);
  const activeSource: SourceRow | undefined = await findActiveSourceByRepository(
    input.organizationId,
    input.request.providerHost,
    resolved.repository.repositoryExternalId,
  );
  if (activeSource !== undefined) {
    return await connectExistingGitSource(input, activeSource, resolved.repositoryAccess, resolved.repository);
  }

  return {
    sourceConnected: true,
    syncRequest: null,
    view: await buildGitSourceView(
      await persistConnectedSourceSummary(input, resolved.repositoryAccess, resolved.repository),
    ),
  };
}

async function resolveConnectRepository(input: ConnectGitSourceInput): Promise<ResolvedConnectRepository> {
  const access: GitProviderAccess = await requireActiveGitProviderAccess(
    input.organizationId,
    input.request.providerHost,
    input.request.repositoryOwner,
  );
  const adapter: GitProviderAdapter = getGitProviderAdapter(access.registration.providerType);
  const ref: GitRepositoryRef = buildConnectRepositoryRef(input.request);
  const providerInstallationId: string | null = await resolveConnectRepositoryInstallationId(adapter, access, ref);
  const repository: GitRepositoryMetadata = await adapter.readRepositoryMetadata(access, ref, providerInstallationId);
  await assertSelectedRepositoryBranchExists(
    adapter,
    access,
    ref,
    providerInstallationId,
    input.request.syncBranchName,
  );

  return {
    repository,
    repositoryAccess: {
      providerInstallationId: requireResolvedInstallationId(providerInstallationId),
      registration: { id: access.registration.id },
    },
  };
}

async function resolveConnectRepositoryInstallationId(
  adapter: GitProviderAdapter,
  access: GitProviderAccess,
  ref: GitRepositoryRef,
): Promise<string | null> {
  try {
    return (await adapter.resolveRepositoryInstallation(access, ref)).providerInstallationId;
  } catch (error) {
    throw createGitSourceRepositoryAccessDeniedError(error instanceof Error ? error.message : undefined);
  }
}

async function assertSelectedRepositoryBranchExists(
  adapter: GitProviderAdapter,
  access: GitProviderAccess,
  ref: GitRepositoryRef,
  providerInstallationId: string | null,
  syncBranchName: string,
): Promise<void> {
  try {
    await adapter.assertRepositoryBranchExists(access, ref, providerInstallationId, syncBranchName);
  } catch (error) {
    if (adapter.isRepositoryAccessFailure(error instanceof Error ? error : undefined)) {
      throw createGitSourceRepositoryAccessDeniedError('The selected repository branch could not be read.');
    }
    throw error;
  }
}

export async function disconnectGitSource(input: DisconnectGitSourceInput): Promise<GitSourceView> {
  const source: SourceRow = await requireActiveConnectedSource(input);
  const view: GitSourceView = await buildGitSourceView(source);
  await getApiDatabase().transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
    const now: Date = new Date();
    await disconnectBindingsBySource(transaction, source.id, now);
    await cancelNonTerminalSourceResolutionTasksBySource(transaction, {
      completedAt: now,
      failureReason: disconnectGitSourceFailureReason,
      sourceId: source.id,
      updatedAt: now,
    });
    await cancelNonTerminalSourceSyncTasksBySource(transaction, {
      completedAt: now,
      failureReason: disconnectGitSourceFailureReason,
      sourceId: source.id,
      updatedAt: now,
    });
    await blockSourceAutomationPrincipalAccessWithExecutor(transaction, source, now);
    await disconnectSource(transaction, source.id, now);
  });
  return view;
}

async function persistConnectedSourceSummary(
  input: ConnectGitSourceInput,
  repositoryAccess: ResolvedRepositoryAccess,
  repository: GitRepositoryMetadata,
): Promise<SourceRow> {
  try {
    return await runPersistConnectedSourceTransaction(input, repositoryAccess, repository);
  } catch (error) {
    const persistedError: Error | undefined = error instanceof Error ? error : undefined;
    if (isUniqueConstraintError(persistedError)) {
      const knownConflictMessage: string | undefined = readKnownConnectConflictMessage(persistedError);
      if (knownConflictMessage !== undefined) {
        throw createGitSourceConflictError(knownConflictMessage);
      }
    }

    throw error;
  }
}

async function runPersistConnectedSourceTransaction(
  input: ConnectGitSourceInput,
  repositoryAccess: ResolvedRepositoryAccess,
  repository: GitRepositoryMetadata,
): Promise<SourceRow> {
  return await getApiDatabase().transaction(async (transaction: SourceMutationTransaction): Promise<SourceRow> => {
    const now: Date = new Date();
    const source: SourceRow = await persistConnectedGitSource(
      transaction,
      buildPersistConnectedGitSourceInput(input, repositoryAccess, repository),
      now,
    );
    await ensureSourceAutomationPrincipalWithExecutor(transaction, source);
    await queueGitSourceSyncTaskForConnect(transaction, source, input.actor.principalId);
    return source;
  });
}

function buildPersistConnectedGitSourceInput(
  input: ConnectGitSourceInput,
  repositoryAccess: ResolvedRepositoryAccess,
  repository: GitRepositoryMetadata,
): PersistConnectedGitSourceInput {
  return {
    actorPrincipalId: input.actor.principalId,
    installationId: repositoryAccess.providerInstallationId,
    organizationId: input.organizationId,
    providerHost: input.request.providerHost,
    providerRegistrationId: repositoryAccess.registration.id,
    repository,
    request: input.request,
    syncBranchName: input.request.syncBranchName,
  };
}

function buildConnectRepositoryRef(request: GitSourceRepositoryRequest): GitRepositoryRef {
  return {
    name: request.repositoryName,
    owner: request.repositoryOwner,
    providerHost: request.providerHost,
  };
}

function requireResolvedInstallationId(providerInstallationId: string | null): string {
  if (providerInstallationId === null) {
    throw new Error('Connecting a GitHub source requires a resolved installation id.');
  }

  return providerInstallationId;
}
