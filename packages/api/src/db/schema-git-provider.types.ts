import type {
  DefaultTimestampBuilder,
  OptionalTextBuilder,
  OptionalTimestampBuilder,
  PgExtraConfigColumnsOf,
  PgTableOf,
  PrimaryTextBuilder,
  RequiredTextBuilder,
  RequiredTimestampBuilder,
} from './schema.shared.types';

interface GitProviderRegistrationsColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  organizationId: RequiredTextBuilder<'organization_id'>;
  providerType: RequiredTextBuilder<'provider_type'>;
  providerHost: RequiredTextBuilder<'provider_host'>;
  providerAccountId: OptionalTextBuilder<'provider_account_id'>;
  providerAccountLogin: OptionalTextBuilder<'provider_account_login'>;
  repositoryOwner: RequiredTextBuilder<'repository_owner'>;
  status: RequiredTextBuilder<'status'>;
  bootstrapStateId: OptionalTextBuilder<'bootstrap_state_id'>;
  pendingExpiresAt: OptionalTimestampBuilder<'pending_expires_at'>;
  webhookSecretCiphertext: OptionalTextBuilder<'webhook_secret_ciphertext'>;
  webhookSecretEncryptionKeyId: OptionalTextBuilder<'webhook_secret_encryption_key_id'>;
  webhookUrl: RequiredTextBuilder<'webhook_url'>;
  callbackUrl: RequiredTextBuilder<'callback_url'>;
  createdByPrincipalId: RequiredTextBuilder<'created_by_principal_id'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

interface GitHubAppRegistrationCredentialsColumnBuilders {
  registrationId: PrimaryTextBuilder<'registration_id'>;
  appId: RequiredTextBuilder<'app_id'>;
  appName: RequiredTextBuilder<'app_name'>;
  appSlug: RequiredTextBuilder<'app_slug'>;
  appUrl: RequiredTextBuilder<'app_url'>;
  installationAccountLogin: RequiredTextBuilder<'installation_account_login'>;
  installationAccountType: RequiredTextBuilder<'installation_account_type'>;
  installationId: RequiredTextBuilder<'installation_id'>;
  privateKeyPemCiphertext: RequiredTextBuilder<'private_key_pem_ciphertext'>;
  privateKeyPemEncryptionKeyId: RequiredTextBuilder<'private_key_pem_encryption_key_id'>;
}

interface GitLabTokenRegistrationCredentialsColumnBuilders {
  registrationId: PrimaryTextBuilder<'registration_id'>;
  accessTokenCiphertext: RequiredTextBuilder<'access_token_ciphertext'>;
  accessTokenEncryptionKeyId: RequiredTextBuilder<'access_token_encryption_key_id'>;
  accessTokenExpiresAt: OptionalTimestampBuilder<'access_token_expires_at'>;
}

interface GitProviderBootstrapStatesColumnBuilders {
  appId: OptionalTextBuilder<'app_id'>;
  appName: OptionalTextBuilder<'app_name'>;
  appSlug: OptionalTextBuilder<'app_slug'>;
  appUrl: OptionalTextBuilder<'app_url'>;
  id: PrimaryTextBuilder<'id'>;
  providerHost: RequiredTextBuilder<'provider_host'>;
  repositoryName: OptionalTextBuilder<'repository_name'>;
  repositoryOwner: RequiredTextBuilder<'repository_owner'>;
  returnTo: OptionalTextBuilder<'return_to'>;
  stateNonce: RequiredTextBuilder<'state_nonce'>;
  providerRegistrationId: RequiredTextBuilder<'provider_registration_id'>;
  privateKeyPemCiphertext: OptionalTextBuilder<'private_key_pem_ciphertext'>;
  privateKeyPemEncryptionKeyId: OptionalTextBuilder<'private_key_pem_encryption_key_id'>;
  createdByPrincipalId: RequiredTextBuilder<'created_by_principal_id'>;
  expiresAt: RequiredTimestampBuilder<'expires_at'>;
  completedAt: OptionalTimestampBuilder<'completed_at'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
}

export type GitProviderRegistrationsTable = PgTableOf<
  'git_provider_registrations',
  GitProviderRegistrationsColumnBuilders
>;
export type GitProviderRegistrationsExtraConfigColumns = PgExtraConfigColumnsOf<
  'git_provider_registrations',
  GitProviderRegistrationsColumnBuilders
>;
export type GitHubAppRegistrationCredentialsTable = PgTableOf<
  'github_app_registration_credentials',
  GitHubAppRegistrationCredentialsColumnBuilders
>;
export type GitLabTokenRegistrationCredentialsTable = PgTableOf<
  'gitlab_token_registration_credentials',
  GitLabTokenRegistrationCredentialsColumnBuilders
>;
export type GitProviderBootstrapStatesTable = PgTableOf<
  'git_provider_bootstrap_states',
  GitProviderBootstrapStatesColumnBuilders
>;
export type GitProviderBootstrapStatesExtraConfigColumns = PgExtraConfigColumnsOf<
  'git_provider_bootstrap_states',
  GitProviderBootstrapStatesColumnBuilders
>;
