import type { Database } from '../db/client';
import type { ApiDatabaseTransaction } from '../db/client.types';
import type { gitProviderBootstrapStates, gitProviderRegistrations } from '../db/schema';

export type GitProviderReadExecutor = Pick<Database, 'select'>;
export type GitProviderWriteExecutor = Database | ApiDatabaseTransaction;
export type GitProviderMutationTransaction = ApiDatabaseTransaction;
export type PersistedGitProviderRegistrationRow = typeof gitProviderRegistrations.$inferSelect;
export type PersistedGitProviderBootstrapStateRow = typeof gitProviderBootstrapStates.$inferSelect;

export interface GitProviderRegistrationRow {
  accessTokenCiphertext: string | null;
  accessTokenEncryptionKeyId: string | null;
  appId: string | null;
  appName: string | null;
  appSlug: string | null;
  appUrl: string | null;
  bootstrapStateId: string | null;
  callbackUrl: string;
  createdAt: Date;
  createdByPrincipalId: string;
  id: string;
  installationAccountLogin: string | null;
  installationAccountType: string | null;
  installationId: string | null;
  pendingExpiresAt: Date | null;
  privateKeyPemCiphertext: string | null;
  privateKeyPemEncryptionKeyId: string | null;
  webhookSecretCiphertext: string | null;
  webhookSecretEncryptionKeyId: string | null;
  webhookUrl: string;
  organizationId: string;
  providerHost: string;
  providerType: string;
  repositoryOwner: string;
  status: string;
  updatedAt: Date;
}

export interface GitProviderBootstrapStateRow {
  completedAt: Date | null;
  createdAt: Date;
  createdByPrincipalId: string;
  expiresAt: Date;
  id: string;
  organizationId: string;
  providerHost: string;
  providerRegistrationId: string;
  repositoryName: string | null;
  repositoryOwner: string;
  returnTo: string | null;
  stateNonce: string;
}

export interface CreatePendingGitProviderRegistrationInput {
  callbackUrl: string;
  createdByPrincipalId: string;
  id: string;
  organizationId: string;
  pendingExpiresAt: Date;
  providerHost: string;
  providerType: string;
  repositoryOwner: string;
  status: string;
  updatedAt: Date;
  webhookUrl: string;
}

export interface ActivateGitProviderRegistrationInput {
  id: string;
  installationAccountLogin: string;
  installationAccountType: string;
  installationId: string;
  organizationId: string;
  status: string;
  updatedAt: Date;
}

export interface PersistGitProviderRegistrationManifestExchangeInput {
  appId: string;
  appName: string | null;
  appSlug: string | null;
  appUrl: string | null;
  id: string;
  organizationId: string;
  privateKeyPemCiphertext: string;
  privateKeyPemEncryptionKeyId: string;
  webhookSecretCiphertext: string;
  webhookSecretEncryptionKeyId: string;
  updatedAt: Date;
}

export interface FailGitProviderRegistrationInput {
  id: string;
  organizationId: string;
  status: string;
  updatedAt: Date;
}

export interface FindGitProviderRegistrationByStatusInput {
  expiresAfter?: Date | undefined;
  organizationId: string;
  providerHost: string;
  providerType?: string | undefined;
  repositoryOwner: string;
  status: string;
}

export interface FindActiveGitProviderRegistrationsByRepositoryOwnersInput {
  organizationId: string;
  providerHost: string;
  repositoryOwners: string[];
}

export interface ReopenActiveGitProviderRegistrationBootstrapInput {
  bootstrapStateId: string;
  id: string;
  organizationId: string;
  pendingExpiresAt: Date;
  updatedAt: Date;
}

export interface CreateGitProviderBootstrapStateInput {
  createdByPrincipalId: string;
  expiresAt: Date;
  id: string;
  organizationId: string;
  providerHost: string;
  providerRegistrationId: string;
  repositoryName: string | null;
  repositoryOwner: string;
  returnTo: string | null;
  stateNonce: string;
}

export interface FindGitProviderRegistrationByIdInput {
  organizationId: string;
  registrationId: string;
}

export interface FindGitProviderBootstrapStateByIdInput {
  bootstrapStateId: string;
  organizationId: string;
}

export interface UpsertGitLabProviderRegistrationInput {
  accessTokenCiphertext: string;
  accessTokenEncryptionKeyId: string;
  callbackUrl: string;
  createdByPrincipalId: string;
  id: string;
  installationAccountLogin: string;
  installationAccountType: string;
  organizationId: string;
  providerHost: string;
  repositoryOwner: string;
  updatedAt: Date;
  webhookSecretCiphertext: string;
  webhookSecretEncryptionKeyId: string;
  webhookUrl: string;
}

export interface FindActiveGitLabProviderRegistrationInput {
  organizationId: string;
  providerHost: string;
  repositoryOwner: string;
}

export interface RotateGitLabProviderRegistrationTokenInput {
  accessTokenCiphertext: string;
  accessTokenEncryptionKeyId: string;
  organizationId: string;
  registrationId: string;
  updatedAt: Date;
}
