import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { getApiDatabase } from '../runtime/runtime-access';
import { gitProviderRegistrations } from '../db/schema';
import { requirePersistedRow } from './persisted-row.query.shared';
import type {
  ActivateGitProviderRegistrationInput,
  CreatePendingGitProviderRegistrationInput,
  FailGitProviderRegistrationInput,
  FindGitProviderRegistrationByIdInput,
  FindGitProviderRegistrationByStatusInput,
  GitProviderReadExecutor,
  GitProviderRegistrationRow,
  GitProviderWriteExecutor,
  PersistGitProviderRegistrationWebhookSecretInput,
  PersistedGitProviderRegistrationRow,
} from './git-provider-registration.query.types';

export async function findGitProviderRegistrationById(
  input: FindGitProviderRegistrationByIdInput,
): Promise<GitProviderRegistrationRow | undefined> {
  return await findGitProviderRegistrationByIdWithExecutor(getApiDatabase(), input);
}

export async function findGitProviderRegistrationByWebhookTarget(
  input: FindGitProviderRegistrationByIdInput,
): Promise<GitProviderRegistrationRow | undefined> {
  return await findGitProviderRegistrationByIdWithExecutor(getApiDatabase(), input);
}

export async function listActiveGitProviderRegistrationsWithExecutor(
  executor: GitProviderReadExecutor,
  organizationId: string,
): Promise<GitProviderRegistrationRow[]> {
  return await executor
    .select()
    .from(gitProviderRegistrations)
    .where(
      and(eq(gitProviderRegistrations.organizationId, organizationId), eq(gitProviderRegistrations.status, 'active')),
    )
    .orderBy(asc(gitProviderRegistrations.createdAt), asc(gitProviderRegistrations.id));
}

export async function findGitProviderRegistrationByIdWithExecutor(
  executor: GitProviderReadExecutor,
  input: FindGitProviderRegistrationByIdInput,
): Promise<GitProviderRegistrationRow | undefined> {
  const rows: PersistedGitProviderRegistrationRow[] = await executor
    .select()
    .from(gitProviderRegistrations)
    .where(
      and(
        eq(gitProviderRegistrations.id, input.registrationId),
        eq(gitProviderRegistrations.organizationId, input.organizationId),
      ),
    )
    .limit(1);

  return mapGitProviderRegistrationRow(rows[0]);
}

export async function createPendingGitProviderRegistration(
  executor: GitProviderWriteExecutor,
  input: CreatePendingGitProviderRegistrationInput,
): Promise<GitProviderRegistrationRow> {
  const [registration]: PersistedGitProviderRegistrationRow[] = await executor
    .insert(gitProviderRegistrations)
    .values({
      bootstrapStateId: null,
      callbackUrl: input.callbackUrl,
      createdByPrincipalId: input.createdByPrincipalId,
      id: input.id,
      organizationId: input.organizationId,
      pendingExpiresAt: input.pendingExpiresAt,
      providerHost: input.providerHost,
      providerType: input.providerType,
      repositoryOwner: input.repositoryOwner,
      status: input.status,
      updatedAt: input.updatedAt,
      webhookUrl: input.webhookUrl,
    })
    .returning();

  return mapRequiredGitProviderRegistrationRow(requirePersistedRow(registration, 'git provider registration'));
}

export async function setGitProviderRegistrationBootstrapState(
  executor: GitProviderWriteExecutor,
  organizationId: string,
  registrationId: string,
  bootstrapStateId: string,
  pendingExpiresAt: Date,
): Promise<void> {
  await executor
    .update(gitProviderRegistrations)
    .set({
      bootstrapStateId,
      pendingExpiresAt,
      updatedAt: new Date(),
    })
    .where(
      and(eq(gitProviderRegistrations.id, registrationId), eq(gitProviderRegistrations.organizationId, organizationId)),
    );
}

export async function activateGitProviderRegistration(
  executor: GitProviderWriteExecutor,
  input: ActivateGitProviderRegistrationInput,
): Promise<GitProviderRegistrationRow | undefined> {
  return await transitionGitProviderRegistration(executor, input, 'pending');
}

export async function persistGitProviderRegistrationWebhookSecret(
  executor: GitProviderWriteExecutor,
  input: PersistGitProviderRegistrationWebhookSecretInput,
): Promise<GitProviderRegistrationRow> {
  const [registration]: PersistedGitProviderRegistrationRow[] = await executor
    .update(gitProviderRegistrations)
    .set({
      updatedAt: input.updatedAt,
      webhookSecretCiphertext: input.webhookSecretCiphertext,
      webhookSecretEncryptionKeyId: input.webhookSecretEncryptionKeyId,
    })
    .where(
      and(eq(gitProviderRegistrations.id, input.id), eq(gitProviderRegistrations.organizationId, input.organizationId)),
    )
    .returning();

  return mapRequiredGitProviderRegistrationRow(requirePersistedRow(registration, 'git provider registration'));
}

export async function failGitProviderRegistration(
  executor: GitProviderWriteExecutor,
  input: FailGitProviderRegistrationInput,
): Promise<void> {
  await failGitProviderRegistrationWithCurrentStatus(executor, input, 'pending');
}

export async function failGitProviderRegistrationWithCurrentStatus(
  executor: GitProviderWriteExecutor,
  input: FailGitProviderRegistrationInput,
  currentStatus: string,
): Promise<void> {
  await transitionGitProviderRegistration(executor, input, currentStatus);
}

async function transitionGitProviderRegistration(
  executor: GitProviderWriteExecutor,
  input: ActivateGitProviderRegistrationInput | FailGitProviderRegistrationInput,
  currentStatus: string,
): Promise<GitProviderRegistrationRow | undefined> {
  const [registration]: PersistedGitProviderRegistrationRow[] = await executor
    .update(gitProviderRegistrations)
    .set({
      bootstrapStateId: null,
      pendingExpiresAt: null,
      status: input.status,
      updatedAt: input.updatedAt,
    })
    .where(
      and(
        eq(gitProviderRegistrations.id, input.id),
        eq(gitProviderRegistrations.organizationId, input.organizationId),
        eq(gitProviderRegistrations.status, currentStatus),
      ),
    )
    .returning();

  return mapGitProviderRegistrationRow(registration);
}

export async function findGitProviderRegistrationByStatusWithExecutor(
  executor: GitProviderReadExecutor,
  input: FindGitProviderRegistrationByStatusInput,
): Promise<GitProviderRegistrationRow | undefined> {
  const rows: PersistedGitProviderRegistrationRow[] = await executor
    .select()
    .from(gitProviderRegistrations)
    .where(
      and(
        eq(sql`lower(${gitProviderRegistrations.providerHost})`, input.providerHost.toLowerCase()),
        eq(gitProviderRegistrations.organizationId, input.organizationId),
        eq(sql`lower(${gitProviderRegistrations.repositoryOwner})`, input.repositoryOwner.toLowerCase()),
        eq(gitProviderRegistrations.status, input.status),
        ...(input.providerType === undefined ? [] : [eq(gitProviderRegistrations.providerType, input.providerType)]),
        ...(input.expiresAfter === undefined
          ? []
          : [gt(gitProviderRegistrations.pendingExpiresAt, input.expiresAfter)]),
      ),
    )
    .limit(1);

  return mapGitProviderRegistrationRow(rows[0]);
}

export function mapGitProviderRegistrationRow(
  row: PersistedGitProviderRegistrationRow | undefined,
): GitProviderRegistrationRow | undefined {
  return row === undefined ? undefined : mapRequiredGitProviderRegistrationRow(row);
}

function mapRequiredGitProviderRegistrationRow(row: PersistedGitProviderRegistrationRow): GitProviderRegistrationRow {
  return row;
}
