import type {
  AppAccessBrowserFlowTarget,
  SsoOidcIdentityVerificationConfig,
  SsoOidcProviderPreset,
  SsoOidcProvisioningPolicy,
} from '@compartment/contracts';
import type { OrganizationRow } from '../../queries/organizations.query.types';
import type { AuthSessionOrganizationPolicySession } from '../organization-auth-settings.service.types';

export interface CreateSsoOidcProviderInput {
  actorPrincipalId: string;
  buttonText?: string | undefined;
  clientId: string;
  clientSecret: string;
  displayName?: string | undefined;
  identityVerification?: SsoOidcIdentityVerificationConfig | undefined;
  issuerUrl?: string | undefined;
  key: string;
  organizationId: string;
  organizationSlug: string;
  preset: SsoOidcProviderPreset;
  provisioning?: SsoOidcProvisioningPolicy | undefined;
  scope?: string | undefined;
}

export interface UpdateSsoOidcProviderInput {
  actorPrincipalId: string;
  buttonText?: string | undefined;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  displayName?: string | undefined;
  identityVerification?: SsoOidcIdentityVerificationConfig | undefined;
  issuerUrl?: string | undefined;
  key?: string | undefined;
  organizationId: string;
  organizationSlug: string;
  preset?: SsoOidcProviderPreset | undefined;
  providerId: string;
  provisioning?: SsoOidcProvisioningPolicy | undefined;
  scope?: string | undefined;
}

export interface ResolvedUpdateSsoOidcProviderInput extends UpdateSsoOidcProviderInput {
  clientId: string;
  clientSecret: string;
  key: string;
  preset: SsoOidcProviderPreset;
}

export interface DeleteSsoOidcProviderInput {
  actorPrincipalId: string;
  providerId: string;
  organizationId: string;
  organizationSlug: string;
}

export interface SsoOidcProviderResult {
  buttonText: string;
  clientId: string;
  createdAt: Date;
  displayName: string;
  id: string;
  identityVerification: SsoOidcIdentityVerificationConfig;
  issuerUrl: string;
  key: string;
  preset: SsoOidcProviderPreset;
  provisioning: SsoOidcProvisioningPolicy;
  scope: string;
  updatedAt: Date;
}

export interface BrowserSsoProviderOption {
  buttonText: string;
  displayName: string;
  loginUrl: string;
  providerId: string;
  preset: SsoOidcProviderPreset;
}

export type BrowserSsoFlowTarget = AppAccessBrowserFlowTarget | null;

export interface StartBrowserSsoLoginInput {
  cliLoginAttemptId?: string | undefined;
  flowTarget: BrowserSsoFlowTarget;
  providerId?: string | undefined;
}

export interface BrowserSsoLoginResult {
  authSession: AuthSessionOrganizationPolicySession;
  flowTarget: BrowserSsoFlowTarget;
  kind: 'browser_session';
  organizations: OrganizationRow[];
  principalEmail: string;
  principalId: string;
  sessionExpiresAt: Date;
  sessionId: string;
  sessionToken: string;
}

export interface CliLoginAttemptAuthenticatedResult {
  kind: 'cli_attempt_authenticated';
  sessionExpiresAt: Date;
  sessionId: string;
  sessionToken: string;
}

export type CompleteSsoOidcLoginResult = BrowserSsoLoginResult | CliLoginAttemptAuthenticatedResult;
