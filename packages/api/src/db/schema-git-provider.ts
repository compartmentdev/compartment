import { sql, type SQL } from 'drizzle-orm';
import { check, pgTable, text, timestamp, type PgTableExtraConfig, uniqueIndex } from 'drizzle-orm/pg-core';
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
    appId: text('app_id'),
    appName: text('app_name'),
    appSlug: text('app_slug'),
    appUrl: text('app_url'),
    installationAccountLogin: text('installation_account_login'),
    installationAccountType: text('installation_account_type'),
    installationId: text('installation_id'),
    privateKeyPemCiphertext: text('private_key_pem_ciphertext'),
    privateKeyPemEncryptionKeyId: text('private_key_pem_encryption_key_id'),
    accessTokenCiphertext: text('access_token_ciphertext'),
    accessTokenEncryptionKeyId: text('access_token_encryption_key_id'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
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
    providerTypeCheck: check(
      'git_provider_registrations_provider_type_check',
      sql`${table.providerType} IN ('github_app', 'gitlab')`,
    ),
    credentialShapeCheck: check('git_provider_registrations_credential_shape_check', buildCredentialShapeCheck(table)),
  };
}

function buildCredentialShapeCheck(table: GitSchemaTypes.GitProviderRegistrationsExtraConfigColumns): SQL {
  return sql`(${buildGitHubCredentialShapeCheck(table)}) OR (${buildGitLabCredentialShapeCheck(table)})`;
}

function buildGitHubCredentialShapeCheck(table: GitSchemaTypes.GitProviderRegistrationsExtraConfigColumns): SQL {
  return sql`
        ${table.providerType} = 'github_app'
        AND ${table.accessTokenCiphertext} IS NULL
        AND ${table.accessTokenEncryptionKeyId} IS NULL
        AND ${table.accessTokenExpiresAt} IS NULL
        AND ${table.providerAccountId} IS NULL
        AND ${table.providerAccountLogin} IS NULL
        AND (
          ${table.status} IN ('pending', 'failed')
          OR (
            ${table.status} = 'active'
            AND ${table.appId} IS NOT NULL
            AND ${table.installationId} IS NOT NULL
            AND ${table.privateKeyPemCiphertext} IS NOT NULL
            AND ${table.privateKeyPemEncryptionKeyId} IS NOT NULL
            AND ${table.webhookSecretCiphertext} IS NOT NULL
            AND ${table.webhookSecretEncryptionKeyId} IS NOT NULL
          )
        )
      `;
}

function buildGitLabCredentialShapeCheck(table: GitSchemaTypes.GitProviderRegistrationsExtraConfigColumns): SQL {
  return sql`
        ${table.providerType} = 'gitlab'
        AND ${table.status} = 'active'
        AND ${table.bootstrapStateId} IS NULL
        AND ${table.pendingExpiresAt} IS NULL
        AND ${table.appId} IS NULL
        AND ${table.appName} IS NULL
        AND ${table.appSlug} IS NULL
        AND ${table.appUrl} IS NULL
        AND ${table.installationAccountLogin} IS NULL
        AND ${table.installationAccountType} IS NULL
        AND ${table.installationId} IS NULL
        AND ${table.privateKeyPemCiphertext} IS NULL
        AND ${table.privateKeyPemEncryptionKeyId} IS NULL
        AND ${table.providerAccountId} IS NOT NULL
        AND ${table.providerAccountLogin} IS NOT NULL
        AND ${table.accessTokenCiphertext} IS NOT NULL
        AND ${table.accessTokenEncryptionKeyId} IS NOT NULL
        AND ${table.webhookSecretCiphertext} IS NOT NULL
        AND ${table.webhookSecretEncryptionKeyId} IS NOT NULL`;
}

export const gitProviderBootstrapStates: GitSchemaTypes.GitProviderBootstrapStatesTable = pgTable(
  'git_provider_bootstrap_states',
  {
    id: text('id').primaryKey(),
    providerHost: text('provider_host').notNull(),
    repositoryName: text('repository_name'),
    repositoryOwner: text('repository_owner').notNull(),
    returnTo: text('return_to'),
    stateNonce: text('state_nonce').notNull(),
    providerRegistrationId: text('provider_registration_id')
      .notNull()
      .references((): typeof gitProviderRegistrations.id => gitProviderRegistrations.id, { onDelete: 'cascade' }),
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
