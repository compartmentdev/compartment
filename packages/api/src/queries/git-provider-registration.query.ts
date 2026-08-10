import { and, eq, gt, sql, type SQL } from 'drizzle-orm';
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
  PersistGitProviderRegistrationManifestExchangeInput,
} from './git-provider-registration.query.types';

interface GitProviderRegistrationManifestExchangeUpdate {
  appId: string;
  appName: string | null;
  appSlug: string | null;
  appUrl: string | null;
  privateKeyPemCiphertext: string;
  privateKeyPemEncryptionKeyId: string;
  updatedAt: Date;
  webhookSecretCiphertext: string;
  webhookSecretEncryptionKeyId: string;
}

export async function findActiveGitProviderRegistration(
  input: Pick<FindGitProviderRegistrationByStatusInput, 'organizationId' | 'providerHost' | 'repositoryOwner'>,
): Promise<GitProviderRegistrationRow | undefined> {
  return await findGitProviderRegistrationByStatusWithExecutor(getApiDatabase(), {
    organizationId: input.organizationId,
    providerHost: input.providerHost,
    repositoryOwner: input.repositoryOwner,
    status: 'active',
  });
}

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

export async function findGitProviderRegistrationByIdWithExecutor(
  executor: GitProviderReadExecutor,
  input: FindGitProviderRegistrationByIdInput,
): Promise<GitProviderRegistrationRow | undefined> {
  const rows: GitProviderRegistrationRow[] = await executor
    .select()
    .from(gitProviderRegistrations)
    .where(registrationInOrganization(input.registrationId, input.organizationId))
    .limit(1);

  return rows[0];
}

/**
 * A registration is addressable only from the organization that owns it. Every read and write states
 * this, so it is written once: an id alone must never select a row.
 */
function registrationInOrganization(registrationId: string, organizationId: string): SQL | undefined {
  return and(
    eq(gitProviderRegistrations.id, registrationId),
    eq(gitProviderRegistrations.organizationId, organizationId),
  );
}

export async function createPendingGitProviderRegistration(
  executor: GitProviderWriteExecutor,
  input: CreatePendingGitProviderRegistrationInput,
): Promise<GitProviderRegistrationRow> {
  const [registration]: GitProviderRegistrationRow[] = await executor
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

  return requirePersistedRow(registration, 'git provider registration');
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
    .where(registrationInOrganization(registrationId, organizationId));
}

export async function activateGitProviderRegistration(
  executor: GitProviderWriteExecutor,
  input: ActivateGitProviderRegistrationInput,
): Promise<GitProviderRegistrationRow | undefined> {
  const [registration]: GitProviderRegistrationRow[] = await executor
    .update(gitProviderRegistrations)
    .set({
      bootstrapStateId: null,
      installationAccountLogin: input.installationAccountLogin,
      installationAccountType: input.installationAccountType,
      installationId: input.installationId,
      pendingExpiresAt: null,
      status: input.status,
      updatedAt: input.updatedAt,
    })
    .where(
      and(registrationInOrganization(input.id, input.organizationId), eq(gitProviderRegistrations.status, 'pending')),
    )
    .returning();

  return registration;
}

export async function persistGitProviderRegistrationManifestExchange(
  executor: GitProviderWriteExecutor,
  input: PersistGitProviderRegistrationManifestExchangeInput,
): Promise<GitProviderRegistrationRow> {
  const [registration]: GitProviderRegistrationRow[] = await executor
    .update(gitProviderRegistrations)
    .set(buildGitProviderRegistrationManifestExchangeUpdate(input))
    .where(registrationInOrganization(input.id, input.organizationId))
    .returning();

  return requirePersistedRow(registration, 'git provider registration');
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
  await executor
    .update(gitProviderRegistrations)
    .set({
      bootstrapStateId: null,
      pendingExpiresAt: null,
      status: input.status,
      updatedAt: input.updatedAt,
    })
    .where(
      and(
        registrationInOrganization(input.id, input.organizationId),
        eq(gitProviderRegistrations.status, currentStatus),
      ),
    );
}

export async function findGitProviderRegistrationByStatusWithExecutor(
  executor: GitProviderReadExecutor,
  input: FindGitProviderRegistrationByStatusInput,
): Promise<GitProviderRegistrationRow | undefined> {
  const rows: GitProviderRegistrationRow[] = await executor
    .select()
    .from(gitProviderRegistrations)
    .where(
      and(
        eq(sql`lower(${gitProviderRegistrations.providerHost})`, input.providerHost.toLowerCase()),
        eq(gitProviderRegistrations.organizationId, input.organizationId),
        eq(sql`lower(${gitProviderRegistrations.repositoryOwner})`, input.repositoryOwner.toLowerCase()),
        eq(gitProviderRegistrations.status, input.status),
        ...(input.expiresAfter === undefined
          ? []
          : [gt(gitProviderRegistrations.pendingExpiresAt, input.expiresAfter)]),
      ),
    )
    .limit(1);

  return rows[0];
}

function buildGitProviderRegistrationManifestExchangeUpdate(
  input: PersistGitProviderRegistrationManifestExchangeInput,
): GitProviderRegistrationManifestExchangeUpdate {
  return {
    appId: input.appId,
    appName: input.appName,
    appSlug: input.appSlug,
    appUrl: input.appUrl,
    privateKeyPemCiphertext: input.privateKeyPemCiphertext,
    privateKeyPemEncryptionKeyId: input.privateKeyPemEncryptionKeyId,
    updatedAt: input.updatedAt,
    webhookSecretCiphertext: input.webhookSecretCiphertext,
    webhookSecretEncryptionKeyId: input.webhookSecretEncryptionKeyId,
  };
}
