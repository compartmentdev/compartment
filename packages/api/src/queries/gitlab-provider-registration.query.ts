import { and, asc, eq } from 'drizzle-orm';
import { gitProviderRegistrations } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { requirePersistedRow } from './persisted-row.query.shared';
import { buildGitProviderRegistrationOrganizationFilter } from './git-provider-registration-scope.query.helpers';
import { mapGitProviderRegistrationRow } from './git-provider-registration.query';
import type {
  FindActiveGitLabProviderRegistrationInput,
  GitProviderRegistrationRow,
  GitProviderWriteExecutor,
  PersistedGitProviderRegistrationRow,
  RotateGitLabProviderRegistrationTokenInput,
  UpsertGitLabProviderRegistrationInput,
} from './git-provider-registration.query.types';

export async function findActiveGitLabProviderRegistration(
  input: FindActiveGitLabProviderRegistrationInput,
): Promise<GitProviderRegistrationRow | undefined> {
  // The owner is the canonical token-holder username from the GitLab /user API,
  // so it matches exactly — consistent with the case-sensitive unique index,
  // unlike GitHub's case-insensitive login matching in the shared query.
  const rows: PersistedGitProviderRegistrationRow[] = await getApiDatabase()
    .select()
    .from(gitProviderRegistrations)
    .where(
      and(
        eq(gitProviderRegistrations.providerType, 'gitlab'),
        eq(gitProviderRegistrations.providerHost, input.providerHost),
        eq(gitProviderRegistrations.repositoryOwner, input.repositoryOwner),
        eq(gitProviderRegistrations.status, 'active'),
        buildGitProviderRegistrationOrganizationFilter(input.organizationId),
      ),
    )
    .limit(1);
  return mapGitProviderRegistrationRow(rows[0], input.organizationId);
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
  input: RotateGitLabProviderRegistrationTokenInput,
): Promise<GitProviderRegistrationRow> {
  const [row]: PersistedGitProviderRegistrationRow[] = await executor
    .update(gitProviderRegistrations)
    .set({
      accessTokenCiphertext: input.accessTokenCiphertext,
      accessTokenEncryptionKeyId: input.accessTokenEncryptionKeyId,
      status: 'active',
      updatedAt: input.updatedAt,
    })
    .where(
      and(
        eq(gitProviderRegistrations.id, input.registrationId),
        buildGitProviderRegistrationOrganizationFilter(input.organizationId, input.registrationId),
      ),
    )
    .returning();
  return { ...requirePersistedRow(row, 'GitLab provider registration'), organizationId: input.organizationId };
}
