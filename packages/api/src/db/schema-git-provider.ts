import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, type PgTableExtraConfig, uniqueIndex } from 'drizzle-orm/pg-core';
import { organizations, principals } from './schema-core';
import type * as GitSchemaTypes from './schema-git-provider.types';

export const gitProviderRegistrations: GitSchemaTypes.GitProviderRegistrationsTable = pgTable(
  'git_provider_registrations',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references((): typeof organizations.id => organizations.id, { onDelete: 'cascade' }),
    providerType: text('provider_type').notNull(),
    providerHost: text('provider_host').notNull(),
    providerAccountId: text('provider_account_id'),
    providerAccountLogin: text('provider_account_login'),
    repositoryOwner: text('repository_owner').notNull(),
    status: text('status').notNull(),
    bootstrapStateId: text('bootstrap_state_id'),
    pendingExpiresAt: timestamp('pending_expires_at', { withTimezone: true }),
    webhookSecretCiphertext: text('webhook_secret_ciphertext'),
    webhookSecretEncryptionKeyId: text('webhook_secret_encryption_key_id'),
    webhookUrl: text('webhook_url').notNull(),
    callbackUrl: text('callback_url').notNull(),
    createdByPrincipalId: text('created_by_principal_id')
      .notNull()
      .references((): typeof principals.id => principals.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  buildGitProviderRegistrationExtraConfig,
);

function buildGitProviderRegistrationExtraConfig(
  table: GitSchemaTypes.GitProviderRegistrationsExtraConfigColumns,
): PgTableExtraConfig {
  return {
    activeOwnerUnique: uniqueIndex('git_provider_registrations_active_owner_unique')
      .on(table.organizationId, table.providerType, table.providerHost, table.repositoryOwner)
      .where(sql`${table.status} = 'active' AND ${table.providerType} = 'github_app'`),
    activeGitLabAccountUnique: uniqueIndex('git_provider_registrations_active_gitlab_account_unique')
      .on(table.organizationId, table.providerType, table.providerHost, table.providerAccountId)
      .where(sql`${table.status} = 'active' AND ${table.providerType} = 'gitlab'`),
    pendingOwnerUnique: uniqueIndex('git_provider_registrations_pending_owner_unique')
      .on(table.organizationId, table.providerType, table.providerHost, table.repositoryOwner)
      .where(sql`${table.status} = 'pending'`),
  };
}

export const githubAppRegistrationCredentials: GitSchemaTypes.GitHubAppRegistrationCredentialsTable = pgTable(
  'github_app_registration_credentials',
  {
    registrationId: text('registration_id')
      .primaryKey()
      .references((): typeof gitProviderRegistrations.id => gitProviderRegistrations.id, { onDelete: 'cascade' }),
    appId: text('app_id').notNull(),
    appName: text('app_name').notNull(),
    appSlug: text('app_slug').notNull(),
    appUrl: text('app_url').notNull(),
    installationAccountLogin: text('installation_account_login').notNull(),
    installationAccountType: text('installation_account_type').notNull(),
    installationId: text('installation_id').notNull(),
    privateKeyPemCiphertext: text('private_key_pem_ciphertext').notNull(),
    privateKeyPemEncryptionKeyId: text('private_key_pem_encryption_key_id').notNull(),
  },
);

export const gitlabTokenRegistrationCredentials: GitSchemaTypes.GitLabTokenRegistrationCredentialsTable = pgTable(
  'gitlab_token_registration_credentials',
  {
    registrationId: text('registration_id')
      .primaryKey()
      .references((): typeof gitProviderRegistrations.id => gitProviderRegistrations.id, { onDelete: 'cascade' }),
    accessTokenCiphertext: text('access_token_ciphertext').notNull(),
    accessTokenEncryptionKeyId: text('access_token_encryption_key_id').notNull(),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  },
);

export const gitProviderBootstrapStates: GitSchemaTypes.GitProviderBootstrapStatesTable = pgTable(
  'git_provider_bootstrap_states',
  {
    appId: text('app_id'),
    appName: text('app_name'),
    appSlug: text('app_slug'),
    appUrl: text('app_url'),
    id: text('id').primaryKey(),
    providerHost: text('provider_host').notNull(),
    repositoryName: text('repository_name'),
    repositoryOwner: text('repository_owner').notNull(),
    returnTo: text('return_to'),
    stateNonce: text('state_nonce').notNull(),
    providerRegistrationId: text('provider_registration_id')
      .notNull()
      .references((): typeof gitProviderRegistrations.id => gitProviderRegistrations.id, { onDelete: 'cascade' }),
    privateKeyPemCiphertext: text('private_key_pem_ciphertext'),
    privateKeyPemEncryptionKeyId: text('private_key_pem_encryption_key_id'),
    createdByPrincipalId: text('created_by_principal_id')
      .notNull()
      .references((): typeof principals.id => principals.id, { onDelete: 'restrict' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: GitSchemaTypes.GitProviderBootstrapStatesExtraConfigColumns): PgTableExtraConfig => ({
    stateNonceUnique: uniqueIndex('git_provider_bootstrap_states_state_nonce_unique').on(table.stateNonce),
  }),
);
