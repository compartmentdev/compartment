import { and, asc, eq } from 'drizzle-orm';
import { gitProviderRegistrations } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { requirePersistedRow } from './persisted-row.query.shared';
import { buildGitProviderRegistrationOrganizationFilter } from './git-provider-registration-scope.query.helpers';
import { mapGitProviderRegistrationRow } from './git-provider-registration.query';
import type {
  GitProviderRegistrationRow,
  GitProviderWriteExecutor,
  PersistedGitProviderRegistrationRow,
  UpsertGitLabProviderRegistrationInput,
} from './git-provider-registration.query.types';

export async function findActiveGitLabProviderRegistration(
  organizationId: string,
  providerHost: string,
  repositoryOwner: string,
): Promise<GitProviderRegistrationRow | undefined> {
  const rows: PersistedGitProviderRegistrationRow[] = await getApiDatabase()
    .select()
    .from(gitProviderRegistrations)
    .where(
      and(
        eq(gitProviderRegistrations.providerType, 'gitlab'),
        eq(gitProviderRegistrations.providerHost, providerHost),
        eq(gitProviderRegistrations.repositoryOwner, repositoryOwner),
        eq(gitProviderRegistrations.status, 'active'),
        buildGitProviderRegistrationOrganizationFilter(organizationId),
      ),
    )
    .limit(1);
  return mapGitProviderRegistrationRow(rows[0], organizationId);
}

export async function listActiveGitLabProviderRegistrations(
  organizationId: string,
): Promise<GitProviderRegistrationRow[]> {
  const rows: PersistedGitProviderRegistrationRow[] = await getApiDatabase()
    .select()
    .from(gitProviderRegistrations)
    .where(
      and(
        eq(gitProviderRegistrations.providerType, 'gitlab'),
        eq(gitProviderRegistrations.status, 'active'),
        buildGitProviderRegistrationOrganizationFilter(organizationId),
      ),
    )
    .orderBy(asc(gitProviderRegistrations.createdAt), asc(gitProviderRegistrations.id));
  return rows.map(
    (row: PersistedGitProviderRegistrationRow): GitProviderRegistrationRow => ({ ...row, organizationId }),
  );
}

export async function createGitLabProviderRegistration(
  executor: GitProviderWriteExecutor,
  input: UpsertGitLabProviderRegistrationInput,
): Promise<GitProviderRegistrationRow> {
  const [row]: PersistedGitProviderRegistrationRow[] = await executor
    .insert(gitProviderRegistrations)
    .values({ ...input, providerType: 'gitlab', status: 'active' })
    .returning();
  return { ...requirePersistedRow(row, 'GitLab provider registration'), organizationId: input.organizationId };
}

export async function rotateGitLabProviderRegistrationToken(
  executor: GitProviderWriteExecutor,
  registrationId: string,
  organizationId: string,
  accessTokenCiphertext: string,
  accessTokenEncryptionKeyId: string,
  updatedAt: Date,
): Promise<GitProviderRegistrationRow> {
  const [row]: PersistedGitProviderRegistrationRow[] = await executor
    .update(gitProviderRegistrations)
    .set({ accessTokenCiphertext, accessTokenEncryptionKeyId, status: 'active', updatedAt })
    .where(
      and(
        eq(gitProviderRegistrations.id, registrationId),
        buildGitProviderRegistrationOrganizationFilter(organizationId, registrationId),
      ),
    )
    .returning();
  return { ...requirePersistedRow(row, 'GitLab provider registration'), organizationId };
}
