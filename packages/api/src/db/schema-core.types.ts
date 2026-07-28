import type {
  DefaultBooleanBuilder,
  DefaultTextBuilder,
  DefaultTimestampBuilder,
  DefaultIntegerBuilder,
  RequiredIntegerBuilder,
  OptionalIntegerBuilder,
  OptionalTextBuilder,
  OptionalTimestampBuilder,
  PgExtraConfigColumnsOf,
  PgTableOf,
  PrimaryTextBuilder,
  RequiredTextBuilder,
  RequiredTimestampBuilder,
} from './schema.shared.types';

type ExtraColumns<TName extends string, TColumnBuilders extends object> = PgExtraConfigColumnsOf<
  TName,
  TColumnBuilders
>;

interface OrganizationsColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  slug: RequiredTextBuilder<'slug'>;
  name: RequiredTextBuilder<'name'>;
  localPasswordEnabled: DefaultBooleanBuilder<'local_password_enabled'>;
  rollbackRetentionMode: DefaultTextBuilder<'rollback_retention_mode'>;
  rollbackRetentionLimit: OptionalIntegerBuilder<'rollback_retention_limit'>;
  auditRetentionMode: DefaultTextBuilder<'audit_retention_mode'>;
  auditRetentionDays: OptionalIntegerBuilder<'audit_retention_days'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
}

interface PrincipalsColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  type: RequiredTextBuilder<'type'>;
  email: RequiredTextBuilder<'email'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
}

interface LocalCredentialsColumnBuilders {
  principalId: PrimaryTextBuilder<'principal_id'>;
  passwordHash: OptionalTextBuilder<'password_hash'>;
  bootstrapTokenHash: OptionalTextBuilder<'bootstrap_token_hash'>;
  bootstrapTokenExpiresAt: OptionalTimestampBuilder<'bootstrap_token_expires_at'>;
  passwordResetTokenHash: OptionalTextBuilder<'password_reset_token_hash'>;
  passwordResetTokenExpiresAt: OptionalTimestampBuilder<'password_reset_token_expires_at'>;
  passwordResetOrganizationId: OptionalTextBuilder<'password_reset_organization_id'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

interface SsoOidcProvidersColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  organizationId: RequiredTextBuilder<'organization_id'>;
  preset: RequiredTextBuilder<'preset'>;
  displayName: RequiredTextBuilder<'display_name'>;
  key: RequiredTextBuilder<'key'>;
  buttonText: RequiredTextBuilder<'button_text'>;
  issuerUrl: RequiredTextBuilder<'issuer_url'>;
  clientId: RequiredTextBuilder<'client_id'>;
  clientSecretCiphertext: RequiredTextBuilder<'client_secret_ciphertext'>;
  clientSecretEncryptionKeyId: RequiredTextBuilder<'client_secret_encryption_key_id'>;
  identityVerificationJson: RequiredTextBuilder<'identity_verification_json'>;
  provisioningPolicyJson: RequiredTextBuilder<'provisioning_policy_json'>;
  scope: RequiredTextBuilder<'scope'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

interface SsoOidcFlowsColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  providerId: RequiredTextBuilder<'provider_id'>;
  cliLoginAttemptId: OptionalTextBuilder<'cli_login_attempt_id'>;
  stateHash: RequiredTextBuilder<'state_hash'>;
  oidcState: RequiredTextBuilder<'oidc_state'>;
  nonce: RequiredTextBuilder<'nonce'>;
  pkceCodeVerifier: RequiredTextBuilder<'pkce_code_verifier'>;
  flowHost: OptionalTextBuilder<'flow_host'>;
  flowPath: OptionalTextBuilder<'flow_path'>;
  flowState: OptionalTextBuilder<'flow_state'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  expiresAt: RequiredTimestampBuilder<'expires_at'>;
  consumedAt: OptionalTimestampBuilder<'consumed_at'>;
}

interface CliLoginAttemptsColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  organizationId: OptionalTextBuilder<'organization_id'>;
  onboardingSessionId: OptionalTextBuilder<'onboarding_session_id'>;
  expectedPrincipalEmail: OptionalTextBuilder<'expected_principal_email'>;
  browserCodeHash: RequiredTextBuilder<'browser_code_hash'>;
  exchangeSecretHash: RequiredTextBuilder<'exchange_secret_hash'>;
  authenticatedPrincipalId: OptionalTextBuilder<'authenticated_principal_id'>;
  authenticatedAuthMethodKind: OptionalTextBuilder<'authenticated_auth_method_kind'>;
  authenticatedOidcProviderId: OptionalTextBuilder<'authenticated_oidc_provider_id'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  expiresAt: RequiredTimestampBuilder<'expires_at'>;
  authenticatedAt: OptionalTimestampBuilder<'authenticated_at'>;
  exchangedAt: OptionalTimestampBuilder<'exchanged_at'>;
}

interface SsoOidcIdentitiesColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  providerId: RequiredTextBuilder<'provider_id'>;
  principalId: RequiredTextBuilder<'principal_id'>;
  subject: RequiredTextBuilder<'subject'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  lastLoginAt: OptionalTimestampBuilder<'last_login_at'>;
}

interface AuthSessionsColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  principalId: RequiredTextBuilder<'principal_id'>;
  authMethodKind: RequiredTextBuilder<'auth_method_kind'>;
  organizationId: OptionalTextBuilder<'organization_id'>;
  oidcProviderId: OptionalTextBuilder<'oidc_provider_id'>;
  tokenHash: RequiredTextBuilder<'token_hash'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  expiresAt: RequiredTimestampBuilder<'expires_at'>;
  revokedAt: OptionalTimestampBuilder<'revoked_at'>;
}

interface AppAccessCodesColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  authSessionId: RequiredTextBuilder<'auth_session_id'>;
  tokenHash: RequiredTextBuilder<'token_hash'>;
  host: RequiredTextBuilder<'host'>;
  state: RequiredTextBuilder<'state'>;
  redirectPath: RequiredTextBuilder<'redirect_path'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  expiresAt: RequiredTimestampBuilder<'expires_at'>;
  consumedAt: OptionalTimestampBuilder<'consumed_at'>;
}

interface AppAccessSessionsColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  authSessionId: RequiredTextBuilder<'auth_session_id'>;
  host: RequiredTextBuilder<'host'>;
  tokenHash: RequiredTextBuilder<'token_hash'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  expiresAt: RequiredTimestampBuilder<'expires_at'>;
  revokedAt: OptionalTimestampBuilder<'revoked_at'>;
}

interface ThrottleBucketsColumnBuilders {
  action: RequiredTextBuilder<'action'>;
  attemptCount: RequiredIntegerBuilder<'attempt_count'>;
  blockedUntilAt: OptionalTimestampBuilder<'blocked_until_at'>;
  bucketKeyHash: RequiredTextBuilder<'bucket_key_hash'>;
  bucketKind: RequiredTextBuilder<'bucket_kind'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  scope: RequiredTextBuilder<'scope'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
  windowStartedAt: RequiredTimestampBuilder<'window_started_at'>;
}

interface SystemDomainSetupStateColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  setupVersion: DefaultIntegerBuilder<'setup_version'>;
  pendingStatus: OptionalTextBuilder<'pending_status'>;
  pendingOperationId: OptionalTextBuilder<'pending_operation_id'>;
  pendingDomainKind: OptionalTextBuilder<'pending_domain_kind'>;
  pendingIssuerRefJson: OptionalTextBuilder<'pending_issuer_ref_json'>;
  pendingTlsMode: OptionalTextBuilder<'pending_tls_mode'>;
  pendingPublicScheme: OptionalTextBuilder<'pending_public_scheme'>;
  pendingBaseDomain: OptionalTextBuilder<'pending_base_domain'>;
  pendingCertificateMetadataJson: OptionalTextBuilder<'pending_certificate_metadata_json'>;
  pendingTlsSecretName: OptionalTextBuilder<'pending_tls_secret_name'>;
  pendingRequiredDnsRecordsJson: OptionalTextBuilder<'pending_required_dns_records_json'>;
  pendingFailureCode: OptionalTextBuilder<'pending_failure_code'>;
  pendingFailureMessage: OptionalTextBuilder<'pending_failure_message'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

interface SystemDomainIdempotencyKeysColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  idempotencyKey: RequiredTextBuilder<'idempotency_key'>;
  requestHash: RequiredTextBuilder<'request_hash'>;
  responseJson: RequiredTextBuilder<'response_json'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
}

interface OperationsColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  type: RequiredTextBuilder<'type'>;
  status: RequiredTextBuilder<'status'>;
  actorPrincipalId: OptionalTextBuilder<'actor_principal_id'>;
  targetType: RequiredTextBuilder<'target_type'>;
  targetId: RequiredTextBuilder<'target_id'>;
  summary: RequiredTextBuilder<'summary'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  completedAt: OptionalTimestampBuilder<'completed_at'>;
}

export interface ProjectsColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  organizationId: RequiredTextBuilder<'organization_id'>;
  name: RequiredTextBuilder<'name'>;
  archivedAt: OptionalTimestampBuilder<'archived_at'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

export interface ProjectServicesColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  projectId: RequiredTextBuilder<'project_id'>;
  name: RequiredTextBuilder<'name'>;
  kind: RequiredTextBuilder<'kind'>;
  path: RequiredTextBuilder<'path'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

export interface EnvironmentsColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  projectId: RequiredTextBuilder<'project_id'>;
  name: RequiredTextBuilder<'name'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}
export type OrganizationsTable = PgTableOf<'organizations', OrganizationsColumnBuilders>;
export type PrincipalsTable = PgTableOf<'principals', PrincipalsColumnBuilders>;
export type PrincipalsExtraConfigColumns = ExtraColumns<'principals', PrincipalsColumnBuilders>;
export type LocalCredentialsTable = PgTableOf<'local_credentials', LocalCredentialsColumnBuilders>;
export type SsoOidcProvidersTable = PgTableOf<'sso_oidc_providers', SsoOidcProvidersColumnBuilders>;
export type SsoOidcProvidersExtraConfigColumns = ExtraColumns<'sso_oidc_providers', SsoOidcProvidersColumnBuilders>;
export type SsoOidcFlowsTable = PgTableOf<'sso_oidc_flows', SsoOidcFlowsColumnBuilders>;
export type CliLoginAttemptsTable = PgTableOf<'cli_login_attempts', CliLoginAttemptsColumnBuilders>;
export type CliLoginAttemptsExtraConfigColumns = ExtraColumns<'cli_login_attempts', CliLoginAttemptsColumnBuilders>;
export type SsoOidcIdentitiesTable = PgTableOf<'sso_oidc_identities', SsoOidcIdentitiesColumnBuilders>;
export type SsoOidcIdentitiesExtraConfigColumns = ExtraColumns<'sso_oidc_identities', SsoOidcIdentitiesColumnBuilders>;
export type AuthSessionsTable = PgTableOf<'auth_sessions', AuthSessionsColumnBuilders>;
export type AppAccessCodesTable = PgTableOf<'app_access_codes', AppAccessCodesColumnBuilders>;
export type AppAccessSessionsTable = PgTableOf<'app_access_sessions', AppAccessSessionsColumnBuilders>;
export type ThrottleBucketsTable = PgTableOf<'throttle_buckets', ThrottleBucketsColumnBuilders>;
export type ThrottleBucketsExtraConfigColumns = ExtraColumns<'throttle_buckets', ThrottleBucketsColumnBuilders>;
export type SystemDomainSetupStateTable = PgTableOf<'system_domain_setup_state', SystemDomainSetupStateColumnBuilders>;
export type SystemDomainIdempotencyKeysTable = PgTableOf<
  'system_domain_idempotency_keys',
  SystemDomainIdempotencyKeysColumnBuilders
>;
export type OperationsTable = PgTableOf<'operations', OperationsColumnBuilders>;
