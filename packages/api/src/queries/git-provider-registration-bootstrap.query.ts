import { and, eq } from 'drizzle-orm';
import { gitProviderRegistrations } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import {
  failGitProviderRegistrationWithCurrentStatus,
  findGitProviderRegistrationByStatusWithExecutor,
} from './git-provider-registration.query';
import type {
  FailGitProviderRegistrationInput,
  GitProviderReadExecutor,
  GitProviderRegistrationRow,
  GitProviderWriteExecutor,
  ReopenActiveGitProviderRegistrationBootstrapInput,
} from './git-provider-registration.query.types';

export async function findPendingGitProviderRegistration(
  organizationId: string,
  providerHost: string,
  repositoryOwner: string,
  now: Date,
): Promise<GitProviderRegistrationRow | undefined> {
  return await findPendingGitProviderRegistrationRow(
    getApiDatabase(),
    organizationId,
    providerHost,
    repositoryOwner,
    now,
  );
}

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
  const [registration]: GitProviderRegistrationRow[] = await executor
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
