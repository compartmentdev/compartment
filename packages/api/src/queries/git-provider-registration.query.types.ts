import type { Database } from '../db/client';
import type { ApiDatabaseTransaction } from '../db/client.types';
import type { gitProviderBootstrapStates, gitProviderRegistrations } from '../db/schema';

export type GitProviderReadExecutor = Pick<Database, 'select'>;
export type GitProviderWriteExecutor = Database | ApiDatabaseTransaction;
export type GitProviderMutationTransaction = ApiDatabaseTransaction;
export type PersistedGitProviderBootstrapStateRow = typeof gitProviderBootstrapStates.$inferSelect;

export type GitProviderRegistrationRow = typeof gitProviderRegistrations.$inferSelect;

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
