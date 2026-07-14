import { and, eq } from 'drizzle-orm';
import { gitProviderRegistrations } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { requirePersistedRow } from './persisted-row.query.shared';
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
  const rows: PersistedGitProviderRegistrationRow[] = await getApiDatabase()
    .select()
    .from(gitProviderRegistrations)
    .where(
      and(
        eq(gitProviderRegistrations.providerType, 'gitlab'),
        eq(gitProviderRegistrations.providerHost, input.providerHost),
        eq(gitProviderRegistrations.providerAccountId, input.providerAccountId),
        eq(gitProviderRegistrations.status, 'active'),
        eq(gitProviderRegistrations.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  return mapGitProviderRegistrationRow(rows[0]);
}

export async function createGitLabProviderRegistration(
  executor: GitProviderWriteExecutor,
  input: UpsertGitLabProviderRegistrationInput,
): Promise<GitProviderRegistrationRow> {
  const [row]: PersistedGitProviderRegistrationRow[] = await executor
    .insert(gitProviderRegistrations)
    .values({ ...input, providerType: 'gitlab', status: 'active' })
    .returning();
  return requirePersistedRow(row, 'GitLab provider registration');
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
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      providerAccountLogin: input.providerAccountLogin,
      repositoryOwner: input.providerAccountLogin,
      status: 'active',
      updatedAt: input.updatedAt,
    })
    .where(
      and(
        eq(gitProviderRegistrations.id, input.registrationId),
        eq(gitProviderRegistrations.organizationId, input.organizationId),
      ),
    )
    .returning();
  return requirePersistedRow(row, 'GitLab provider registration');
}
