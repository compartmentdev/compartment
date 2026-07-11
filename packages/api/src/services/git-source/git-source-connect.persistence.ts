import type { ConnectGitSourceRequest } from '@compartment/contracts';
import { createSource, findReconnectableSourceByRepository, updateSourceToActive } from '../../queries/source.query';
import type { SourceMutationTransaction, SourceRow } from '../../queries/source.query.types';
import type { GitRepositoryMetadata } from './git-source-provider.types';
import { buildCreateSourceInput, buildUpdateSourceInput } from './git-source-connect.persistence.support';

export interface PersistConnectedGitSourceInput {
  actorPrincipalId: string;
  installationId: string | null;
  providerWebhookId?: string | null | undefined;
  organizationId: string;
  providerHost: string;
  providerRegistrationId: string;
  repository: GitRepositoryMetadata;
  request: ConnectGitSourceRequest;
  syncBranchName: string;
}

interface GitSourceUpsertInput {
  actorPrincipalId: string;
  autoAdoptNewApps: boolean;
  defaultAutoDeployEnabled: boolean;
  defaultEnvironmentName: string;
  installationId: string | null;
  organizationId: string;
  providerHost: string;
  providerRegistrationId: string;
  providerWebhookId: string | null;
  repository: GitRepositoryMetadata;
  syncBranchName: string;
}

export async function persistConnectedGitSource(
  transaction: SourceMutationTransaction,
  input: PersistConnectedGitSourceInput,
  now: Date,
): Promise<SourceRow> {
  const reconnectableSource: SourceRow | undefined = await findReconnectableSourceByRepository(
    transaction,
    input.organizationId,
    input.providerHost,
    input.repository.repositoryExternalId,
  );
  if (reconnectableSource === undefined) {
    return await createSource(transaction, buildCreateSourceInput(buildSourceUpsertInput(input), now));
  }

  return await updateSourceToActive(
    transaction,
    buildUpdateSourceInput(buildSourceUpsertInput(input), reconnectableSource.id, now),
  );
}

function buildSourceUpsertInput(input: PersistConnectedGitSourceInput): GitSourceUpsertInput {
  return {
    actorPrincipalId: input.actorPrincipalId,
    autoAdoptNewApps: input.request.autoAdoptNewApps,
    defaultAutoDeployEnabled: input.request.defaultAutoDeployEnabled,
    defaultEnvironmentName: input.request.defaultEnvironmentName,
    installationId: input.installationId,
    organizationId: input.organizationId,
    providerHost: input.providerHost,
    providerRegistrationId: input.providerRegistrationId,
    providerWebhookId: input.providerWebhookId ?? null,
    repository: input.repository,
    syncBranchName: input.syncBranchName,
  };
}
