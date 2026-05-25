import { and, asc, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import { getApiDatabase } from '../runtime/runtime-access';
import { sources } from '../db/schema';
import { requirePersistedRow } from './persisted-row.query.shared';
import type {
  CreateSourceInput,
  PersistedSourceRow,
  SourceMutationTransaction,
  SourceReadExecutor,
  SourceRow,
  SourceStatus,
  SourceWriteExecutor,
  UpdateSourceSettingsInput,
  UpdateSourceSyncMetadataInput,
  UpdateSourceToActiveInput,
} from './source.query.types';

export {
  findActiveSourceByAutomationPrincipal,
  findSourceBindingById,
  listActiveBindingsBySourceIds,
  listActiveBindingsBySourceIdsWithExecutor,
  listActiveSourcesByProviderInstallation,
  listActiveSourcesByProviderRepository,
  listBranchMappingsByBindingIds,
  listBranchMappingsByBindingIdsWithExecutor,
  updateSourceAutomationPrincipal,
  updateSourceToDisabled,
} from './source-runtime.query';
export {
  clearDisconnectedBindingProjectReferences,
  createSourceBinding,
  disconnectBindingsBySource,
  disconnectSourceBindingById,
  findActiveBindingByDescriptorPathWithExecutor,
  findActiveBindingByProjectIdWithExecutor,
  findDisconnectedBindingByDescriptorPath,
  findDisconnectedBindingByIdWithExecutor,
  findDisconnectedBindingByProjectIdWithExecutor,
  listActiveAndDisconnectedBindingsBySourceIdsWithExecutor,
  replaceBranchMappingsForBinding,
  updateSourceBindingToActive,
  updateSourceBindingWatchPaths,
} from './source-binding.query';

export async function listConnectedSourcesByOrganization(organizationId: string): Promise<SourceRow[]> {
  return await getApiDatabase()
    .select()
    .from(sources)
    .where(
      and(eq(sources.organizationId, organizationId), or(eq(sources.status, 'active'), eq(sources.status, 'disabled'))),
    )
    .orderBy(asc(sources.createdAt));
}

export async function findConnectedSourceById(
  organizationId: string,
  sourceId: string,
): Promise<SourceRow | undefined> {
  const rows: PersistedSourceRow[] = await getApiDatabase()
    .select()
    .from(sources)
    .where(
      and(
        eq(sources.organizationId, organizationId),
        eq(sources.id, sourceId),
        or(eq(sources.status, 'active'), eq(sources.status, 'disabled')),
      ),
    )
    .limit(1);

  return rows[0];
}

export async function findSourceById(sourceId: string): Promise<SourceRow | undefined> {
  const rows: PersistedSourceRow[] = await getApiDatabase()
    .select()
    .from(sources)
    .where(eq(sources.id, sourceId))
    .limit(1);
  return rows[0];
}

export async function findActiveSourceByRepository(
  organizationId: string,
  providerHost: string,
  repositoryExternalId: string,
): Promise<SourceRow | undefined> {
  return await findSourceByRepositoryWithStatus(
    getApiDatabase(),
    organizationId,
    providerHost,
    repositoryExternalId,
    'active',
  );
}

export async function findReconnectableSourceByRepository(
  executor: SourceReadExecutor,
  organizationId: string,
  providerHost: string,
  repositoryExternalId: string,
): Promise<SourceRow | undefined> {
  const rows: PersistedSourceRow[] = await executor
    .select()
    .from(sources)
    .where(
      and(
        buildSourceByRepositoryFilter(organizationId, providerHost, repositoryExternalId),
        or(eq(sources.status, 'disconnected'), eq(sources.status, 'disabled')),
      ),
    )
    .orderBy(desc(sources.updatedAt))
    .limit(1);

  return rows[0];
}

export async function createSource(executor: SourceWriteExecutor, input: CreateSourceInput): Promise<SourceRow> {
  const [source]: PersistedSourceRow[] = await executor.insert(sources).values(input).returning();
  return requirePersistedRow(source, 'source');
}

export async function updateSourceToActive(
  executor: SourceWriteExecutor,
  input: UpdateSourceToActiveInput,
): Promise<SourceRow> {
  const [source]: PersistedSourceRow[] = await executor
    .update(sources)
    .set(buildUpdateSourceToActiveValues(input))
    .where(eq(sources.id, input.sourceId))
    .returning();

  return requirePersistedRow(source, 'source');
}

function buildUpdateSourceToActiveValues(input: UpdateSourceToActiveInput): Partial<PersistedSourceRow> {
  return {
    autoAdoptNewApps: input.autoAdoptNewApps,
    defaultAutoDeployEnabled: input.defaultAutoDeployEnabled,
    defaultBranchName: input.defaultBranchName,
    defaultEnvironmentName: input.defaultEnvironmentName,
    disconnectedAt: null,
    displayName: input.displayName,
    ...(input.lastSyncAt !== undefined ? { lastSyncAt: input.lastSyncAt } : {}),
    providerInstallationId: input.providerInstallationId,
    providerRegistrationId: input.providerRegistrationId,
    repositoryCloneUrl: input.repositoryCloneUrl,
    repositoryName: input.repositoryName,
    repositoryOwner: input.repositoryOwner,
    status: 'active',
    syncBranchName: input.syncBranchName,
    updatedAt: input.updatedAt,
  };
}

export async function disconnectSource(executor: SourceWriteExecutor, sourceId: string, now: Date): Promise<void> {
  await executor
    .update(sources)
    .set({
      disconnectedAt: now,
      status: 'disconnected',
      updatedAt: now,
    })
    .where(eq(sources.id, sourceId));
}

export async function updateSourceSyncMetadata(
  executor: SourceWriteExecutor,
  input: UpdateSourceSyncMetadataInput,
): Promise<SourceRow> {
  const [source]: PersistedSourceRow[] = await executor
    .update(sources)
    .set({
      lastSyncAt: input.lastSyncAt,
      updatedAt: input.updatedAt,
    })
    .where(eq(sources.id, input.sourceId))
    .returning();

  return requirePersistedRow(source, 'source');
}

export async function updateSourceSettings(
  executor: SourceWriteExecutor,
  input: UpdateSourceSettingsInput,
): Promise<SourceRow> {
  const [source]: PersistedSourceRow[] = await executor
    .update(sources)
    .set({
      autoAdoptNewApps: input.autoAdoptNewApps,
      updatedAt: input.updatedAt,
    })
    .where(eq(sources.id, input.sourceId))
    .returning();

  return requirePersistedRow(source, 'source');
}

export async function lockSourceMutationWithExecutor(
  executor: SourceMutationTransaction,
  sourceId: string,
): Promise<void> {
  await executor.execute(sql`select ${sources.id} from ${sources} where ${sources.id} = ${sourceId} for update`);
}

async function findSourceByRepositoryWithStatus(
  executor: SourceReadExecutor,
  organizationId: string,
  providerHost: string,
  repositoryExternalId: string,
  status: SourceStatus,
): Promise<SourceRow | undefined> {
  const rows: PersistedSourceRow[] = await executor
    .select()
    .from(sources)
    .where(
      and(
        buildSourceByRepositoryFilter(organizationId, providerHost, repositoryExternalId),
        eq(sources.status, status),
      ),
    )
    .limit(1);

  return rows[0];
}

function buildSourceByRepositoryFilter(
  organizationId: string,
  providerHost: string,
  repositoryExternalId: string,
): SQL {
  return and(
    eq(sources.organizationId, organizationId),
    eq(sources.providerHost, providerHost),
    eq(sources.repositoryExternalId, repositoryExternalId),
  )!;
}
