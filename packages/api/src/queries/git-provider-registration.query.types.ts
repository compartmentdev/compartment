import type { Database } from '../db/client';
import type { ApiDatabaseTransaction } from '../db/client.types';
import type {
  githubAppRegistrationCredentials,
  gitlabTokenRegistrationCredentials,
  gitProviderBootstrapStates,
  gitProviderRegistrations,
} from '../db/schema';

export type GitProviderReadExecutor = Pick<Database, 'select'>;
export type GitProviderWriteExecutor = Database | ApiDatabaseTransaction;
export type GitProviderMutationTransaction = ApiDatabaseTransaction;
export type PersistedGitProviderRegistrationRow = typeof gitProviderRegistrations.$inferSelect;
export type PersistedGitProviderBootstrapStateRow = typeof gitProviderBootstrapStates.$inferSelect;
export type GitHubAppRegistrationCredentialRow = typeof githubAppRegistrationCredentials.$inferSelect;
export type GitLabTokenRegistrationCredentialRow = typeof gitlabTokenRegistrationCredentials.$inferSelect;

export interface GitProviderRegistrationRow {
  bootstrapStateId: string | null;
  callbackUrl: string;
  createdAt: Date;
  createdByPrincipalId: string;
  id: string;
  pendingExpiresAt: Date | null;
  webhookSecretCiphertext: string | null;
  webhookSecretEncryptionKeyId: string | null;
  webhookUrl: string;
  organizationId: string;
  providerAccountId: string | null;
  providerAccountLogin: string | null;
  providerHost: string;
  providerType: string;
  repositoryOwner: string;
  status: string;
  updatedAt: Date;
}

export interface GitProviderBootstrapStateRow {
  appId: string | null;
  appName: string | null;
  appSlug: string | null;
  appUrl: string | null;
  completedAt: Date | null;
  createdAt: Date;
  createdByPrincipalId: string;
  expiresAt: Date;
  id: string;
  organizationId: string;
  providerHost: string;
  providerRegistrationId: string;
  privateKeyPemCiphertext: string | null;
  privateKeyPemEncryptionKeyId: string | null;
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
  organizationId: string;
  status: string;
  updatedAt: Date;
}

export interface PersistGitProviderRegistrationWebhookSecretInput {
  id: string;
  organizationId: string;
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

export interface StageGitHubAppRegistrationCredentialInput {
  appId: string;
  appName: string | null;
  appSlug: string | null;
  appUrl: string | null;
  privateKeyPemCiphertext: string;
  privateKeyPemEncryptionKeyId: string;
  registrationId: string;
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
  accessTokenExpiresAt: Date | null;
  callbackUrl: string;
  createdByPrincipalId: string;
  id: string;
  organizationId: string;
  providerAccountId: string;
  providerAccountLogin: string;
  providerHost: string;
  repositoryOwner: string;
  updatedAt: Date;
  webhookSecretCiphertext: string;
  webhookSecretEncryptionKeyId: string;
  webhookUrl: string;
}

export interface CreateGitHubAppRegistrationCredentialInput {
  appId: string;
  appName: string;
  appSlug: string;
  appUrl: string;
  installationAccountLogin: string;
  installationAccountType: string;
  installationId: string;
  privateKeyPemCiphertext: string;
  privateKeyPemEncryptionKeyId: string;
  registrationId: string;
}

export interface UpsertGitLabTokenRegistrationCredentialInput {
  accessTokenCiphertext: string;
  accessTokenEncryptionKeyId: string;
  accessTokenExpiresAt: Date | null;
  registrationId: string;
}

export interface FindActiveGitLabProviderRegistrationInput {
  organizationId: string;
  providerAccountId: string;
  providerHost: string;
}

export interface RotateGitLabProviderRegistrationTokenInput {
  accessTokenCiphertext: string;
  accessTokenEncryptionKeyId: string;
  accessTokenExpiresAt: Date | null;
  organizationId: string;
  providerAccountLogin: string;
  registrationId: string;
  updatedAt: Date;
}
