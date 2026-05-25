import { and, asc, eq, inArray, type SQL } from 'drizzle-orm';
import { sourceBindingBranchMappings, sourceBindings, sources } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { requirePersistedRow } from './persisted-row.query.shared';
import { listBindingsBySourceIdsWithStatusesWithExecutor } from './source-binding.query';
import type {
  PersistedSourceBindingRow,
  PersistedSourceRow,
  SourceBindingBranchMappingRow,
  SourceBindingRow,
  SourceReadExecutor,
  SourceRow,
  SourceWriteExecutor,
  UpdateSourceAutomationPrincipalInput,
  UpdateSourceToDisabledInput,
} from './source.query.types';

export async function listActiveSourcesByProviderRepository(
  organizationId: string,
  providerRegistrationId: string,
  providerInstallationId: string,
  providerHost: string,
  repositoryExternalId: string,
): Promise<SourceRow[]> {
  return await listActiveSourcesByProviderSelector({
    organizationId,
    providerHost,
    providerInstallationId,
    providerRegistrationId,
    repositoryExternalId,
  });
}

export async function listActiveSourcesByProviderInstallation(
  organizationId: string,
  providerRegistrationId: string,
  providerInstallationId: string,
  providerHost: string,
): Promise<SourceRow[]> {
  return await listActiveSourcesByProviderSelector({
    organizationId,
    providerHost,
    providerInstallationId,
    providerRegistrationId,
  });
}

async function listActiveSourcesByProviderSelector(input: {
  organizationId: string;
  providerHost: string;
  providerInstallationId: string;
  providerRegistrationId: string;
  repositoryExternalId?: string | undefined;
}): Promise<SourceRow[]> {
  const conditions: SQL[] = [
    eq(sources.organizationId, input.organizationId),
    eq(sources.providerRegistrationId, input.providerRegistrationId),
    eq(sources.providerInstallationId, input.providerInstallationId),
    eq(sources.providerHost, input.providerHost),
    eq(sources.status, 'active'),
  ];
  if (input.repositoryExternalId !== undefined) {
    conditions.push(eq(sources.repositoryExternalId, input.repositoryExternalId));
  }

  return await getApiDatabase()
    .select()
    .from(sources)
    .where(and(...conditions))
    .orderBy(asc(sources.createdAt), asc(sources.id));
}

export async function findActiveSourceByAutomationPrincipal(input: {
  organizationId: string;
  principalId: string;
  sourceId: string;
}): Promise<SourceRow | undefined> {
  const rows: SourceRow[] = await getApiDatabase()
    .select()
    .from(sources)
    .where(
      and(
        eq(sources.automationPrincipalId, input.principalId),
        eq(sources.id, input.sourceId),
        eq(sources.organizationId, input.organizationId),
        eq(sources.status, 'active'),
      ),
    )
    .limit(1);

  return rows[0];
}

export async function updateSourceToDisabled(
  executor: SourceWriteExecutor,
  input: UpdateSourceToDisabledInput,
): Promise<SourceRow> {
  const [source]: PersistedSourceRow[] = await executor
    .update(sources)
    .set({
      status: 'disabled',
      updatedAt: input.updatedAt,
    })
    .where(eq(sources.id, input.sourceId))
    .returning();

  return requirePersistedRow(source, 'source');
}

export async function updateSourceAutomationPrincipal(
  executor: SourceWriteExecutor,
  input: UpdateSourceAutomationPrincipalInput,
): Promise<SourceRow> {
  const [source]: PersistedSourceRow[] = await executor
    .update(sources)
    .set({
      automationPrincipalId: input.automationPrincipalId,
      updatedAt: input.updatedAt,
    })
    .where(eq(sources.id, input.sourceId))
    .returning();

  return requirePersistedRow(source, 'source');
}

export async function listActiveBindingsBySourceIds(sourceIds: readonly string[]): Promise<SourceBindingRow[]> {
  return await listActiveBindingsBySourceIdsWithExecutor(getApiDatabase(), sourceIds);
}

export async function listActiveBindingsBySourceIdsWithExecutor(
  executor: SourceReadExecutor,
  sourceIds: readonly string[],
): Promise<SourceBindingRow[]> {
  const rows: SourceBindingRow[] = await listBindingsBySourceIdsWithStatusesWithExecutor(executor, sourceIds, [
    'active',
  ]);
  return rows.sort(compareBindingsByCreatedAt);
}

export async function listBranchMappingsByBindingIds(
  bindingIds: readonly string[],
): Promise<SourceBindingBranchMappingRow[]> {
  return await listBranchMappingsByBindingIdsWithExecutor(getApiDatabase(), bindingIds);
}

export async function listBranchMappingsByBindingIdsWithExecutor(
  executor: SourceReadExecutor,
  bindingIds: readonly string[],
): Promise<SourceBindingBranchMappingRow[]> {
  if (bindingIds.length === 0) {
    return [];
  }

  return await executor
    .select()
    .from(sourceBindingBranchMappings)
    .where(inArray(sourceBindingBranchMappings.sourceBindingId, [...bindingIds]))
    .orderBy(asc(sourceBindingBranchMappings.createdAt));
}

export async function findSourceBindingById(sourceBindingId: string): Promise<SourceBindingRow | undefined> {
  const rows: PersistedSourceBindingRow[] = await getApiDatabase()
    .select()
    .from(sourceBindings)
    .where(eq(sourceBindings.id, sourceBindingId))
    .limit(1);

  return rows[0];
}

function compareBindingsByCreatedAt(left: SourceBindingRow, right: SourceBindingRow): number {
  const createdAtDiff: number = left.createdAt.getTime() - right.createdAt.getTime();
  if (createdAtDiff !== 0) {
    return createdAtDiff;
  }

  return left.id.localeCompare(right.id);
}
