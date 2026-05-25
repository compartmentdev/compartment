import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  type PgTableExtraConfig,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type * as CoreSchemaTypes from './schema-core.types';
import { ssoOidcProviderOrganizationKeyUniqueConstraintName } from '../sso-oidc.constants';

export const organizations: CoreSchemaTypes.OrganizationsTable = pgTable('organizations', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  localPasswordEnabled: boolean('local_password_enabled').default(true).notNull(),
  rollbackRetentionMode: text('rollback_retention_mode', { enum: ['inherit', 'indefinite', 'keep_last'] })
    .default('inherit')
    .notNull(),
  rollbackRetentionLimit: integer('rollback_retention_limit'),
  auditRetentionMode: text('audit_retention_mode', { enum: ['inherit', 'indefinite', 'keep_days'] })
    .default('inherit')
    .notNull(),
  auditRetentionDays: integer('audit_retention_days'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const principals: CoreSchemaTypes.PrincipalsTable = pgTable(
  'principals',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    email: text('email').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: CoreSchemaTypes.PrincipalsExtraConfigColumns): PgTableExtraConfig => ({
    emailLowerUnique: uniqueIndex('principals_email_lower_unique').on(sql`lower(${table.email})`),
  }),
);

export const localCredentials: CoreSchemaTypes.LocalCredentialsTable = pgTable('local_credentials', {
  principalId: text('principal_id')
    .primaryKey()
    .references((): typeof principals.id => principals.id, { onDelete: 'cascade' }),
  passwordHash: text('password_hash'),
  bootstrapTokenHash: text('bootstrap_token_hash'),
  bootstrapTokenExpiresAt: timestamp('bootstrap_token_expires_at', { withTimezone: true }),
  passwordResetTokenHash: text('password_reset_token_hash'),
  passwordResetTokenExpiresAt: timestamp('password_reset_token_expires_at', { withTimezone: true }),
  passwordResetOrganizationId: text('password_reset_organization_id').references(
    (): typeof organizations.id => organizations.id,
    {
      onDelete: 'set null',
    },
  ),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const ssoOidcProviders: CoreSchemaTypes.SsoOidcProvidersTable = pgTable(
  'sso_oidc_providers',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references((): typeof organizations.id => organizations.id, { onDelete: 'cascade' }),
    preset: text('preset').notNull(),
    displayName: text('display_name').notNull(),
    key: text('key').notNull(),
    buttonText: text('button_text').notNull(),
    issuerUrl: text('issuer_url').notNull(),
    clientId: text('client_id').notNull(),
    clientSecretCiphertext: text('client_secret_ciphertext').notNull(),
    clientSecretEncryptionKeyId: text('client_secret_encryption_key_id').notNull(),
    identityVerificationJson: text('identity_verification_json').notNull(),
    provisioningPolicyJson: text('provisioning_policy_json').notNull(),
    scope: text('scope').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: CoreSchemaTypes.SsoOidcProvidersExtraConfigColumns): PgTableExtraConfig => ({
    organizationKeyUnique: uniqueIndex(ssoOidcProviderOrganizationKeyUniqueConstraintName).on(
      table.organizationId,
      table.key,
    ),
  }),
);

export const ssoOidcFlows: CoreSchemaTypes.SsoOidcFlowsTable = pgTable('sso_oidc_flows', {
  id: text('id').primaryKey(),
  providerId: text('provider_id')
    .notNull()
    .references((): typeof ssoOidcProviders.id => ssoOidcProviders.id, { onDelete: 'cascade' }),
  cliLoginAttemptId: text('cli_login_attempt_id').references((): typeof cliLoginAttempts.id => cliLoginAttempts.id, {
    onDelete: 'set null',
  }),
  stateHash: text('state_hash').notNull().unique(),
  oidcState: text('oidc_state').notNull(),
  nonce: text('nonce').notNull(),
  pkceCodeVerifier: text('pkce_code_verifier').notNull(),
  flowHost: text('flow_host'),
  flowPath: text('flow_path'),
  flowState: text('flow_state'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
});

export const cliLoginAttempts: CoreSchemaTypes.CliLoginAttemptsTable = pgTable(
  'cli_login_attempts',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').references((): typeof organizations.id => organizations.id, {
      onDelete: 'cascade',
    }),
    onboardingSessionId: text('onboarding_session_id'),
    expectedPrincipalEmail: text('expected_principal_email'),
    browserCodeHash: text('browser_code_hash').notNull().unique(),
    exchangeSecretHash: text('exchange_secret_hash').notNull().unique(),
    authenticatedPrincipalId: text('authenticated_principal_id').references((): typeof principals.id => principals.id, {
      onDelete: 'set null',
    }),
    authenticatedAuthMethodKind: text('authenticated_auth_method_kind'),
    authenticatedOidcProviderId: text('authenticated_oidc_provider_id').references(
      (): typeof ssoOidcProviders.id => ssoOidcProviders.id,
      {
        onDelete: 'set null',
      },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    authenticatedAt: timestamp('authenticated_at', { withTimezone: true }),
    exchangedAt: timestamp('exchanged_at', { withTimezone: true }),
  },
  (table: CoreSchemaTypes.CliLoginAttemptsExtraConfigColumns): PgTableExtraConfig => ({
    onboardingSessionOrganizationCreatedAtIndex: index('cli_login_attempts_onboarding_session_org_created_at_idx').on(
      table.onboardingSessionId,
      table.organizationId,
      table.createdAt,
    ),
  }),
);

export const ssoOidcIdentities: CoreSchemaTypes.SsoOidcIdentitiesTable = pgTable(
  'sso_oidc_identities',
  {
    id: text('id').primaryKey(),
    providerId: text('provider_id')
      .notNull()
      .references((): typeof ssoOidcProviders.id => ssoOidcProviders.id, { onDelete: 'cascade' }),
    principalId: text('principal_id')
      .notNull()
      .references((): typeof principals.id => principals.id, { onDelete: 'cascade' }),
    subject: text('subject').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (table: CoreSchemaTypes.SsoOidcIdentitiesExtraConfigColumns): PgTableExtraConfig => ({
    providerPrincipalUnique: unique('sso_oidc_identities_provider_principal_unique').on(
      table.providerId,
      table.principalId,
    ),
    providerSubjectUnique: unique('sso_oidc_identities_provider_subject_unique').on(table.providerId, table.subject),
  }),
);

export const authSessions: CoreSchemaTypes.AuthSessionsTable = pgTable('auth_sessions', {
  id: text('id').primaryKey(),
  principalId: text('principal_id')
    .notNull()
    .references((): typeof principals.id => principals.id, { onDelete: 'cascade' }),
  authMethodKind: text('auth_method_kind').notNull(),
  organizationId: text('organization_id').references((): typeof organizations.id => organizations.id, {
    onDelete: 'set null',
  }),
  oidcProviderId: text('oidc_provider_id').references((): typeof ssoOidcProviders.id => ssoOidcProviders.id, {
    onDelete: 'set null',
  }),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const appAccessCodes: CoreSchemaTypes.AppAccessCodesTable = pgTable('app_access_codes', {
  id: text('id').primaryKey(),
  authSessionId: text('auth_session_id')
    .notNull()
    .references((): typeof authSessions.id => authSessions.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  host: text('host').notNull(),
  state: text('state').notNull(),
  redirectPath: text('redirect_path').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
});

export const appAccessSessions: CoreSchemaTypes.AppAccessSessionsTable = pgTable('app_access_sessions', {
  id: text('id').primaryKey(),
  authSessionId: text('auth_session_id')
    .notNull()
    .references((): typeof authSessions.id => authSessions.id, { onDelete: 'cascade' }),
  host: text('host').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const throttleBuckets: CoreSchemaTypes.ThrottleBucketsTable = pgTable(
  'throttle_buckets',
  {
    action: text('action').notNull(),
    attemptCount: integer('attempt_count').notNull(),
    blockedUntilAt: timestamp('blocked_until_at', { withTimezone: true }),
    bucketKeyHash: text('bucket_key_hash').notNull(),
    bucketKind: text('bucket_kind').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    scope: text('scope').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull(),
  },
  (table: CoreSchemaTypes.ThrottleBucketsExtraConfigColumns): PgTableExtraConfig => ({
    scopeActionBucketUnique: uniqueIndex('throttle_buckets_scope_action_bucket_unique').on(
      table.scope,
      table.action,
      table.bucketKind,
      table.bucketKeyHash,
    ),
  }),
);
