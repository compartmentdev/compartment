import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, type PgTableExtraConfig, uniqueIndex } from 'drizzle-orm/pg-core';
import { principals } from './schema-core';
import type * as GitSchemaTypes from './schema-git.types';

export const gitProviderRegistrations: GitSchemaTypes.GitProviderRegistrationsTable = pgTable(
  'git_provider_registrations',
  {
    id: text('id').primaryKey(),
    providerType: text('provider_type').notNull(),
    providerHost: text('provider_host').notNull(),
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
  (table: GitSchemaTypes.GitProviderRegistrationsExtraConfigColumns): PgTableExtraConfig => ({
    activeOwnerUnique: uniqueIndex('git_provider_registrations_active_owner_unique')
      .on(table.providerType, table.providerHost, table.repositoryOwner)
      .where(sql`${table.status} = 'active' AND ${table.providerType} = 'github_app'`),
    // This organization extractor depends on the buildWebhookUrl path format and must change with it.
    activeGitLabOrganizationOwnerUnique: uniqueIndex(
      'git_provider_registrations_active_gitlab_organization_owner_unique',
    )
      .on(
        table.providerType,
        table.providerHost,
        table.repositoryOwner,
        sql`substring(${table.webhookUrl} from '/organizations/([^/]+)/registrations/')`,
      )
      .where(sql`${table.status} = 'active' AND ${table.providerType} = 'gitlab'`),
    pendingOwnerUnique: uniqueIndex('git_provider_registrations_pending_owner_unique')
      .on(table.providerType, table.providerHost, table.repositoryOwner)
      .where(sql`${table.status} = 'pending'`),
  }),
);

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
