import type { ConnectGitSourceRequest } from '@compartment/contracts';
import { createSource, findReconnectableSourceByRepository, updateSourceToActive } from '../../queries/source.query';
import type { SourceMutationTransaction, SourceRow } from '../../queries/source.query.types';
import type { GitRepositoryMetadata } from './git-source-provider.types';
import { buildCreateSourceInput, buildUpdateSourceInput } from './git-source-connect.persistence.support';

export interface PersistConnectedGitSourceInput {
  actorPrincipalId: string;
  installationId: string;
  organizationId: string;
  providerHost: string;
  providerRegistrationId: string;
  repository: GitRepositoryMetadata;
  request: ConnectGitSourceRequest;
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

function buildSourceUpsertInput(input: PersistConnectedGitSourceInput): {
  actorPrincipalId: string;
  autoAdoptNewApps: boolean;
  defaultAutoDeployEnabled: boolean;
  defaultEnvironmentName: string;
  installationId: string;
  organizationId: string;
  providerHost: string;
  providerRegistrationId: string;
  repository: GitRepositoryMetadata;
  syncBranchName: string;
} {
  return {
    actorPrincipalId: input.actorPrincipalId,
    autoAdoptNewApps: input.request.autoAdoptNewApps,
    defaultAutoDeployEnabled: input.request.defaultAutoDeployEnabled,
    defaultEnvironmentName: input.request.defaultEnvironmentName,
    installationId: input.installationId,
    organizationId: input.organizationId,
    providerHost: input.providerHost,
    providerRegistrationId: input.providerRegistrationId,
    repository: input.repository,
    syncBranchName: input.syncBranchName,
  };
}
