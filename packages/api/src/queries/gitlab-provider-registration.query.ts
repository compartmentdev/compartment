import { and, eq } from 'drizzle-orm';
import { gitProviderRegistrations } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { requirePersistedRow } from './persisted-row.query.shared';
import { upsertGitLabTokenRegistrationCredential } from './gitlab-token-registration-credential.query';
import { mapGitProviderRegistrationRow } from './git-provider-registration.query';
import type {
  FindActiveGitLabProviderRegistrationInput,
  GitProviderRegistrationRow,
  GitProviderMutationTransaction,
  PersistedGitProviderRegistrationRow,
  RotateGitLabProviderRegistrationTokenInput,
  UpsertGitLabProviderRegistrationInput,
} from './git-provider-registration.query.types';

type GitProviderRegistrationInsert = typeof gitProviderRegistrations.$inferInsert;

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
  executor: GitProviderMutationTransaction,
  input: UpsertGitLabProviderRegistrationInput,
): Promise<GitProviderRegistrationRow> {
  const [row]: PersistedGitProviderRegistrationRow[] = await executor
    .insert(gitProviderRegistrations)
    .values(buildGitLabProviderRegistrationInsert(input))
    .returning();
  const registration: PersistedGitProviderRegistrationRow = requirePersistedRow(row, 'GitLab provider registration');
  await persistGitLabTokenCredential(executor, registration.id, input);
  return registration;
}

export async function rotateGitLabProviderRegistrationToken(
  executor: GitProviderMutationTransaction,
  input: RotateGitLabProviderRegistrationTokenInput,
): Promise<GitProviderRegistrationRow> {
  const [row]: PersistedGitProviderRegistrationRow[] = await executor
    .update(gitProviderRegistrations)
    .set({
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
  const registration: PersistedGitProviderRegistrationRow = requirePersistedRow(row, 'GitLab provider registration');
  await persistGitLabTokenCredential(executor, registration.id, input);
  return registration;
}

function buildGitLabProviderRegistrationInsert(
  input: UpsertGitLabProviderRegistrationInput,
): GitProviderRegistrationInsert {
  return {
    callbackUrl: input.callbackUrl,
    createdByPrincipalId: input.createdByPrincipalId,
    id: input.id,
    organizationId: input.organizationId,
    providerAccountId: input.providerAccountId,
    providerAccountLogin: input.providerAccountLogin,
    providerHost: input.providerHost,
    providerType: 'gitlab',
    repositoryOwner: input.repositoryOwner,
    status: 'active',
    updatedAt: input.updatedAt,
    webhookSecretCiphertext: input.webhookSecretCiphertext,
    webhookSecretEncryptionKeyId: input.webhookSecretEncryptionKeyId,
    webhookUrl: input.webhookUrl,
  };
}

async function persistGitLabTokenCredential(
  executor: GitProviderMutationTransaction,
  registrationId: string,
  input: UpsertGitLabProviderRegistrationInput | RotateGitLabProviderRegistrationTokenInput,
): Promise<void> {
  await upsertGitLabTokenRegistrationCredential(executor, {
    accessTokenCiphertext: input.accessTokenCiphertext,
    accessTokenEncryptionKeyId: input.accessTokenEncryptionKeyId,
    accessTokenExpiresAt: input.accessTokenExpiresAt,
    registrationId,
  });
}
