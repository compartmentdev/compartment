import { createGitSourceBootstrapInvalidError } from '../../errors/api-business-error';
import {
  activateGitProviderRegistration,
  createPendingGitProviderRegistration,
  failGitProviderRegistration,
  persistGitProviderRegistrationManifestExchange,
  setGitProviderRegistrationBootstrapState,
} from '../../queries/git-provider-registration.query';
import {
  createGitProviderBootstrapState,
  markGitProviderBootstrapStateCompleted,
} from '../../queries/git-provider-bootstrap-state.query';
import {
  failActiveGitProviderRegistration as failActiveGitProviderRegistrationRow,
  findAnyPendingGitProviderRegistrationWithExecutor,
  reopenActiveGitProviderRegistrationBootstrap,
} from '../../queries/git-provider-registration-bootstrap.query';
import type {
  GitProviderRegistrationRow,
  GitProviderWriteExecutor,
} from '../../queries/git-provider-registration.query.types';
import type { GitHubAppInstallation, GitHubManifestConversionResult } from './github-app-client.adapter.types';
import type { GitHubManifestSecrets, PendingGitHubBootstrapMaterial } from './git-source-bootstrap.support';
import type { StartGitHubProviderBootstrapInput } from './git-source.service.types';

const gitHubProviderType: string = 'github_app';

export async function persistPendingGitHubProviderManifestExchange(
  transaction: GitProviderWriteExecutor,
  registration: Pick<GitProviderRegistrationRow, 'id' | 'organizationId'>,
  exchanged: GitHubManifestConversionResult,
  encryptedSecrets: GitHubManifestSecrets,
  now: Date,
): Promise<void> {
  await persistGitProviderRegistrationManifestExchange(transaction, {
    appId: exchanged.appId,
    appName: exchanged.appName,
    appSlug: exchanged.appSlug,
    appUrl: exchanged.appUrl,
    id: registration.id,
    organizationId: registration.organizationId,
    privateKeyPemCiphertext: encryptedSecrets.privateKeyPemCiphertext,
    privateKeyPemEncryptionKeyId: encryptedSecrets.privateKeyPemEncryptionKeyId,
    webhookSecretCiphertext: encryptedSecrets.webhookSecretCiphertext,
    webhookSecretEncryptionKeyId: encryptedSecrets.webhookSecretEncryptionKeyId,
    updatedAt: now,
  });
}

export async function activatePersistedGitHubProviderRegistration(
  transaction: GitProviderWriteExecutor,
  registration: Pick<GitProviderRegistrationRow, 'id' | 'organizationId'>,
  installation: GitHubAppInstallation,
  now: Date,
): Promise<void> {
  const updatedRegistration: GitProviderRegistrationRow | undefined = await activateGitProviderRegistration(
    transaction,
    {
      id: registration.id,
      installationAccountLogin: installation.accountLogin,
      installationAccountType: installation.accountType,
      installationId: installation.installationId,
      organizationId: registration.organizationId,
      status: 'active',
      updatedAt: now,
    },
  );
  if (updatedRegistration === undefined) {
    throw createGitSourceBootstrapInvalidError('Git provider registration is no longer pending.');
  }
}

export async function failPendingGitHubBootstrapForOwner(
  transaction: GitProviderWriteExecutor,
  organizationId: string,
  providerHost: string,
  repositoryOwner: string,
  now: Date,
): Promise<void> {
  const pendingRegistration: GitProviderRegistrationRow | undefined =
    await findAnyPendingGitProviderRegistrationWithExecutor(transaction, organizationId, providerHost, repositoryOwner);
  if (pendingRegistration !== undefined) {
    await failPendingGitHubBootstrap(transaction, pendingRegistration, now);
  }
}

export async function failPendingGitHubBootstrap(
  transaction: GitProviderWriteExecutor,
  pendingRegistration: GitProviderRegistrationRow,
  now: Date,
): Promise<void> {
  await failPendingGitHubProviderRegistration(transaction, pendingRegistration, now);
  if (pendingRegistration.bootstrapStateId !== null) {
    await markGitProviderBootstrapStateCompleted(
      transaction,
      pendingRegistration.organizationId,
      pendingRegistration.bootstrapStateId,
      now,
    );
  }
}

export async function failPendingGitHubProviderRegistration(
  transaction: GitProviderWriteExecutor,
  registration: Pick<GitProviderRegistrationRow, 'id' | 'organizationId'>,
  now: Date,
): Promise<void> {
  await failGitProviderRegistration(transaction, {
    id: registration.id,
    organizationId: registration.organizationId,
    status: 'failed',
    updatedAt: now,
  });
}

export async function failActiveGitHubProviderRegistration(
  transaction: GitProviderWriteExecutor,
  registration: Pick<GitProviderRegistrationRow, 'id' | 'organizationId'>,
  now: Date,
): Promise<void> {
  await failActiveGitProviderRegistrationRow(transaction, {
    id: registration.id,
    organizationId: registration.organizationId,
    status: 'failed',
    updatedAt: now,
  });
}

export async function persistPendingGitHubBootstrap(
  transaction: GitProviderWriteExecutor,
  input: StartGitHubProviderBootstrapInput,
  bootstrapMaterial: PendingGitHubBootstrapMaterial,
  now: Date,
): Promise<void> {
  await persistPendingGitProviderRegistration(transaction, input, bootstrapMaterial, now);
  await persistPendingBootstrapState(transaction, input, bootstrapMaterial);
  await setGitProviderRegistrationBootstrapState(
    transaction,
    input.organizationId,
    bootstrapMaterial.registrationId,
    bootstrapMaterial.stateId,
    bootstrapMaterial.expiresAt,
  );
}

export async function reopenActiveGitHubProviderRegistrationBootstrap(
  transaction: GitProviderWriteExecutor,
  input: StartGitHubProviderBootstrapInput,
  bootstrapMaterial: PendingGitHubBootstrapMaterial,
  now: Date,
): Promise<void> {
  await persistPendingBootstrapState(transaction, input, bootstrapMaterial);
  const registration: GitProviderRegistrationRow | undefined = await reopenActiveGitProviderRegistrationBootstrap(
    transaction,
    {
      bootstrapStateId: bootstrapMaterial.stateId,
      id: bootstrapMaterial.registrationId,
      organizationId: input.organizationId,
      pendingExpiresAt: bootstrapMaterial.expiresAt,
      updatedAt: now,
    },
  );
  if (registration === undefined) {
    throw createGitSourceBootstrapInvalidError('Git provider registration is no longer active.');
  }
}

async function persistPendingGitProviderRegistration(
  transaction: GitProviderWriteExecutor,
  input: StartGitHubProviderBootstrapInput,
  bootstrapMaterial: PendingGitHubBootstrapMaterial,
  now: Date,
): Promise<void> {
  await createPendingGitProviderRegistration(transaction, {
    callbackUrl: bootstrapMaterial.callbackUrl,
    createdByPrincipalId: input.actor.principalId,
    id: bootstrapMaterial.registrationId,
    organizationId: input.organizationId,
    pendingExpiresAt: bootstrapMaterial.expiresAt,
    providerHost: input.providerHost,
    providerType: gitHubProviderType,
    repositoryOwner: input.repositoryOwner,
    status: 'pending',
    updatedAt: now,
    webhookUrl: bootstrapMaterial.webhookUrl,
  });
}

async function persistPendingBootstrapState(
  transaction: GitProviderWriteExecutor,
  input: StartGitHubProviderBootstrapInput,
  bootstrapMaterial: PendingGitHubBootstrapMaterial,
): Promise<void> {
  await createGitProviderBootstrapState(transaction, {
    createdByPrincipalId: input.actor.principalId,
    expiresAt: bootstrapMaterial.expiresAt,
    id: bootstrapMaterial.stateId,
    organizationId: input.organizationId,
    providerHost: input.providerHost,
    providerRegistrationId: bootstrapMaterial.registrationId,
    repositoryName: null,
    repositoryOwner: input.repositoryOwner,
    returnTo: input.returnTo ?? null,
    stateNonce: bootstrapMaterial.stateNonce,
  });
}
