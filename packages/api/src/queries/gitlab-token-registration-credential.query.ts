import { eq } from 'drizzle-orm';
import { gitlabTokenRegistrationCredentials } from '../db/schema';
import { requirePersistedRow } from './persisted-row.query.shared';
import type {
  GitLabTokenRegistrationCredentialRow,
  GitProviderReadExecutor,
  GitProviderWriteExecutor,
  UpsertGitLabTokenRegistrationCredentialInput,
} from './git-provider-registration.query.types';

export async function findGitLabTokenRegistrationCredential(
  executor: GitProviderReadExecutor,
  registrationId: string,
): Promise<GitLabTokenRegistrationCredentialRow | undefined> {
  const rows: GitLabTokenRegistrationCredentialRow[] = await executor
    .select()
    .from(gitlabTokenRegistrationCredentials)
    .where(eq(gitlabTokenRegistrationCredentials.registrationId, registrationId))
    .limit(1);
  return rows[0];
}

export async function upsertGitLabTokenRegistrationCredential(
  executor: GitProviderWriteExecutor,
  input: UpsertGitLabTokenRegistrationCredentialInput,
): Promise<GitLabTokenRegistrationCredentialRow> {
  const [row]: GitLabTokenRegistrationCredentialRow[] = await executor
    .insert(gitlabTokenRegistrationCredentials)
    .values(input)
    .onConflictDoUpdate({
      set: {
        accessTokenCiphertext: input.accessTokenCiphertext,
        accessTokenEncryptionKeyId: input.accessTokenEncryptionKeyId,
        accessTokenExpiresAt: input.accessTokenExpiresAt,
      },
      target: gitlabTokenRegistrationCredentials.registrationId,
    })
    .returning();
  return requirePersistedRow(row, 'GitLab token registration credential');
}
