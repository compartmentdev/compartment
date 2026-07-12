import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import { gitProviderRegistrations } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { buildGitProviderRegistrationOrganizationFilter } from './git-provider-registration-scope.query.helpers';
import type {
  FindActiveGitProviderRegistrationsByRepositoryOwnersInput,
  GitProviderRegistrationRow,
  PersistedGitProviderRegistrationRow,
} from './git-provider-registration.query.types';

export async function findActiveGitProviderRegistrationsByRepositoryOwners(
  input: FindActiveGitProviderRegistrationsByRepositoryOwnersInput,
): Promise<GitProviderRegistrationRow[]> {
  const repositoryOwners: string[] = readNormalizedRepositoryOwners(input.repositoryOwners);
  if (repositoryOwners.length === 0) {
    return [];
  }

  const rows: PersistedGitProviderRegistrationRow[] = await getApiDatabase()
    .select()
    .from(gitProviderRegistrations)
    .where(
      and(
        eq(sql`lower(${gitProviderRegistrations.providerHost})`, input.providerHost.toLowerCase()),
        buildGitProviderRegistrationOrganizationFilter(input.organizationId),
        eq(gitProviderRegistrations.status, 'active'),
        or(...repositoryOwners.map(buildGitProviderRepositoryOwnerFilter)),
      ),
    );

  return rows.map(
    (row: PersistedGitProviderRegistrationRow): GitProviderRegistrationRow => ({
      ...row,
      organizationId: input.organizationId,
    }),
  );
}

function readNormalizedRepositoryOwners(repositoryOwners: string[]): string[] {
  return Array.from(
    new Set(
      repositoryOwners
        .map((repositoryOwner: string): string => repositoryOwner.trim().toLowerCase())
        .filter((repositoryOwner: string): boolean => repositoryOwner.length > 0),
    ),
  );
}

function buildGitProviderRepositoryOwnerFilter(repositoryOwner: string): SQL {
  return eq(sql`lower(${gitProviderRegistrations.repositoryOwner})`, repositoryOwner);
}
