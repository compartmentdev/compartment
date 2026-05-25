import { and, eq, gt, sql } from 'drizzle-orm';
import { getApiDatabase } from '../runtime/runtime-access';
import { gitProviderRegistrations } from '../db/schema';
import { requirePersistedRow } from './persisted-row.query.shared';
import { buildGitProviderRegistrationOrganizationFilter } from './git-provider-registration-scope.query.helpers';
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
  PersistedGitProviderRegistrationRow,
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
  const rows: PersistedGitProviderRegistrationRow[] = await executor
    .select()
    .from(gitProviderRegistrations)
    .where(
      and(
        eq(gitProviderRegistrations.id, input.registrationId),
        buildGitProviderRegistrationOrganizationFilter(input.organizationId, input.registrationId),
      ),
    )
    .limit(1);

  return mapGitProviderRegistrationRow(rows[0], input.organizationId);
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
      pendingExpiresAt: input.pendingExpiresAt,
      providerHost: input.providerHost,
      providerType: input.providerType,
      repositoryOwner: input.repositoryOwner,
      status: input.status,
      updatedAt: input.updatedAt,
      webhookUrl: input.webhookUrl,
    })
    .returning();

  return mapRequiredGitProviderRegistrationRow(
    requirePersistedRow(registration, 'git provider registration'),
    input.organizationId,
  );
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
      and(
        eq(gitProviderRegistrations.id, registrationId),
        buildGitProviderRegistrationOrganizationFilter(organizationId, registrationId),
      ),
    );
}

export async function activateGitProviderRegistration(
  executor: GitProviderWriteExecutor,
  input: ActivateGitProviderRegistrationInput,
): Promise<GitProviderRegistrationRow | undefined> {
  const [registration]: PersistedGitProviderRegistrationRow[] = await executor
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
      and(
        eq(gitProviderRegistrations.id, input.id),
        buildGitProviderRegistrationOrganizationFilter(input.organizationId, input.id),
        eq(gitProviderRegistrations.status, 'pending'),
      ),
    )
    .returning();

  return mapGitProviderRegistrationRow(registration, input.organizationId);
}

export async function persistGitProviderRegistrationManifestExchange(
  executor: GitProviderWriteExecutor,
  input: PersistGitProviderRegistrationManifestExchangeInput,
): Promise<GitProviderRegistrationRow> {
  const [registration]: PersistedGitProviderRegistrationRow[] = await executor
    .update(gitProviderRegistrations)
    .set(buildGitProviderRegistrationManifestExchangeUpdate(input))
    .where(
      and(
        eq(gitProviderRegistrations.id, input.id),
        buildGitProviderRegistrationOrganizationFilter(input.organizationId, input.id),
      ),
    )
    .returning();

  return mapRequiredGitProviderRegistrationRow(
    requirePersistedRow(registration, 'git provider registration'),
    input.organizationId,
  );
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
        eq(gitProviderRegistrations.id, input.id),
        buildGitProviderRegistrationOrganizationFilter(input.organizationId, input.id),
        eq(gitProviderRegistrations.status, currentStatus),
      ),
    );
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
        buildGitProviderRegistrationOrganizationFilter(input.organizationId),
        eq(sql`lower(${gitProviderRegistrations.repositoryOwner})`, input.repositoryOwner.toLowerCase()),
        eq(gitProviderRegistrations.status, input.status),
        ...(input.expiresAfter === undefined
          ? []
          : [gt(gitProviderRegistrations.pendingExpiresAt, input.expiresAfter)]),
      ),
    )
    .limit(1);

  return mapGitProviderRegistrationRow(rows[0], input.organizationId);
}

export function mapGitProviderRegistrationRow(
  row: PersistedGitProviderRegistrationRow | undefined,
  organizationId: string,
): GitProviderRegistrationRow | undefined {
  return row === undefined ? undefined : mapRequiredGitProviderRegistrationRow(row, organizationId);
}

function mapRequiredGitProviderRegistrationRow(
  row: PersistedGitProviderRegistrationRow,
  organizationId: string,
): GitProviderRegistrationRow {
  return { ...row, organizationId };
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
