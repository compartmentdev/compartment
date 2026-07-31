import { and, eq, isNull } from 'drizzle-orm';
import { gitProviderBootstrapStates, githubAppRegistrationCredentials } from '../db/schema';
import { requirePersistedRow } from './persisted-row.query.shared';
import type {
  CreateGitHubAppRegistrationCredentialInput,
  GitHubAppRegistrationCredentialRow,
  GitProviderReadExecutor,
  GitProviderWriteExecutor,
  PersistedGitProviderBootstrapStateRow,
  StageGitHubAppRegistrationCredentialInput,
} from './git-provider-registration.query.types';

export async function findGitHubAppRegistrationCredential(
  executor: GitProviderReadExecutor,
  registrationId: string,
): Promise<GitHubAppRegistrationCredentialRow | undefined> {
  const rows: GitHubAppRegistrationCredentialRow[] = await executor
    .select()
    .from(githubAppRegistrationCredentials)
    .where(eq(githubAppRegistrationCredentials.registrationId, registrationId))
    .limit(1);
  return rows[0];
}

export async function createGitHubAppRegistrationCredential(
  executor: GitProviderWriteExecutor,
  input: CreateGitHubAppRegistrationCredentialInput,
): Promise<GitHubAppRegistrationCredentialRow> {
  const [row]: GitHubAppRegistrationCredentialRow[] = await executor
    .insert(githubAppRegistrationCredentials)
    .values(input)
    .returning();
  return requirePersistedRow(row, 'GitHub App registration credential');
}

export async function deleteGitHubAppRegistrationCredential(
  executor: GitProviderWriteExecutor,
  registrationId: string,
): Promise<void> {
  await executor
    .delete(githubAppRegistrationCredentials)
    .where(eq(githubAppRegistrationCredentials.registrationId, registrationId));
}

export async function stageGitHubAppRegistrationCredential(
  executor: GitProviderWriteExecutor,
  input: StageGitHubAppRegistrationCredentialInput,
): Promise<PersistedGitProviderBootstrapStateRow> {
  const [row]: PersistedGitProviderBootstrapStateRow[] = await executor
    .update(gitProviderBootstrapStates)
    .set({
      appId: input.appId,
      appName: input.appName,
      appSlug: input.appSlug,
      appUrl: input.appUrl,
      privateKeyPemCiphertext: input.privateKeyPemCiphertext,
      privateKeyPemEncryptionKeyId: input.privateKeyPemEncryptionKeyId,
    })
    .where(
      and(
        eq(gitProviderBootstrapStates.providerRegistrationId, input.registrationId),
        isNull(gitProviderBootstrapStates.completedAt),
      ),
    )
    .returning();
  return requirePersistedRow(row, 'Git provider bootstrap state');
}
