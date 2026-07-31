import { and, eq } from 'drizzle-orm';
import { gitProviderRegistrations } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import {
  deleteGitHubAppRegistrationCredential,
  findGitHubAppRegistrationCredential,
  stageGitHubAppRegistrationCredential,
} from './github-app-registration-credential.query';
import {
  failGitProviderRegistrationWithCurrentStatus,
  findGitProviderRegistrationByStatusWithExecutor,
  mapGitProviderRegistrationRow,
} from './git-provider-registration.query';
import type {
  FailGitProviderRegistrationInput,
  GitProviderReadExecutor,
  GitProviderRegistrationRow,
  GitHubAppRegistrationCredentialRow,
  GitProviderWriteExecutor,
  PersistedGitProviderRegistrationRow,
  ReopenActiveGitProviderRegistrationBootstrapInput,
} from './git-provider-registration.query.types';

export async function findAnyPendingGitProviderRegistration(
  organizationId: string,
  providerHost: string,
  repositoryOwner: string,
): Promise<GitProviderRegistrationRow | undefined> {
  return await findPendingGitProviderRegistrationRow(getApiDatabase(), organizationId, providerHost, repositoryOwner);
}

export async function findAnyPendingGitProviderRegistrationWithExecutor(
  executor: GitProviderReadExecutor,
  organizationId: string,
  providerHost: string,
  repositoryOwner: string,
): Promise<GitProviderRegistrationRow | undefined> {
  return await findPendingGitProviderRegistrationRow(executor, organizationId, providerHost, repositoryOwner);
}

async function findPendingGitProviderRegistrationRow(
  executor: GitProviderReadExecutor,
  organizationId: string,
  providerHost: string,
  repositoryOwner: string,
  now?: Date,
): Promise<GitProviderRegistrationRow | undefined> {
  return await findGitProviderRegistrationByStatusWithExecutor(executor, {
    expiresAfter: now,
    organizationId,
    providerHost,
    repositoryOwner,
    status: 'pending',
  });
}

export async function failActiveGitProviderRegistration(
  executor: GitProviderWriteExecutor,
  input: FailGitProviderRegistrationInput,
): Promise<void> {
  await failGitProviderRegistrationWithCurrentStatus(executor, input, 'active');
}

export async function reopenActiveGitProviderRegistrationBootstrap(
  executor: GitProviderWriteExecutor,
  input: ReopenActiveGitProviderRegistrationBootstrapInput,
): Promise<GitProviderRegistrationRow | undefined> {
  if (!(await stageActiveGitHubCredentialForBootstrap(executor, input.id))) {
    return undefined;
  }
  const registration: PersistedGitProviderRegistrationRow | undefined = await markRegistrationPending(executor, input);
  if (registration !== undefined) {
    await deleteGitHubAppRegistrationCredential(executor, registration.id);
  }
  return mapGitProviderRegistrationRow(registration);
}

async function markRegistrationPending(
  executor: GitProviderWriteExecutor,
  input: ReopenActiveGitProviderRegistrationBootstrapInput,
): Promise<PersistedGitProviderRegistrationRow | undefined> {
  const [registration]: PersistedGitProviderRegistrationRow[] = await executor
    .update(gitProviderRegistrations)
    .set({
      bootstrapStateId: input.bootstrapStateId,
      pendingExpiresAt: input.pendingExpiresAt,
      status: 'pending',
      updatedAt: input.updatedAt,
    })
    .where(
      and(
        eq(gitProviderRegistrations.id, input.id),
        eq(gitProviderRegistrations.organizationId, input.organizationId),
        eq(gitProviderRegistrations.status, 'active'),
      ),
    )
    .returning();
  return registration;
}

async function stageActiveGitHubCredentialForBootstrap(
  executor: GitProviderWriteExecutor,
  registrationId: string,
): Promise<boolean> {
  const credential: GitHubAppRegistrationCredentialRow | undefined = await findGitHubAppRegistrationCredential(
    executor,
    registrationId,
  );
  if (credential === undefined) return false;
  await stageGitHubAppRegistrationCredential(executor, {
    ...credential,
    registrationId,
  });
  return true;
}
