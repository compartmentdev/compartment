import type { AppAccessBrowserFlowTarget } from './app-access-protocol.contract';
import type { PermissionKey } from './access.contract';
import type { OrganizationSummary } from './organizations.contract';

export type AuthSessionDelivery = 'cookie' | 'token';

export interface PrincipalSummary {
  email: string;
  id: string;
  type: 'user';
}

export interface LoginOrganizationChoice {
  name: string;
  slug: string;
}

export interface LoginSsoProviderOption {
  buttonText: string;
  loginUrl: string;
  providerId: string;
}

export interface AuthFlowTargetFields {
  host?: string | undefined;
  path?: string | undefined;
  state?: string | undefined;
}

export interface LoginStateQuery extends AuthFlowTargetFields {
  autoRedirect?: boolean | undefined;
}

export interface AuthTokenStateQuery extends AuthFlowTargetFields {
  email?: string | undefined;
}

export interface AuthTokenStateResponse {
  email?: string | undefined;
  flowTarget: AppAccessBrowserFlowTarget | null;
  hasToken: boolean;
  principalEmail?: string | undefined;
}

export interface LoginDiscoveryRequest extends AuthFlowTargetFields {
  autoRedirect?: boolean | undefined;
  email: string;
  organizationSlug?: string | undefined;
}

export interface LoginRequest extends AuthFlowTargetFields {
  email: string;
  organizationSlug?: string | undefined;
  password: string;
  sessionDelivery?: AuthSessionDelivery | undefined;
}

export interface ActivateRequest extends AuthFlowTargetFields {
  bootstrapToken?: string | undefined;
  email: string;
  password: string;
  sessionDelivery?: AuthSessionDelivery | undefined;
}

export interface LoginTokenResponse {
  organizations: OrganizationSummary[];
  principal: PrincipalSummary;
  redirectTo?: undefined;
  sessionToken: string;
}

export interface LoginCookieResponse {
  organizations: OrganizationSummary[];
  principal: PrincipalSummary;
  redirectTo: string;
  sessionToken?: undefined;
}

export type LoginResponse = LoginTokenResponse | LoginCookieResponse;

export interface CliLoginStartRequest {
  email?: string | undefined;
  onboardingSessionId?: string | undefined;
  organizationSlug?: string | undefined;
}

export interface CliLoginStartResponse {
  attemptId: string;
  exchangeSecret: string;
  expiresAt: string;
  pollAfterMs: number;
  verificationUrl: string;
}

export interface CliLoginStatusRequest {
  attemptId: string;
  exchangeSecret: string;
}

export interface CliLoginPendingStatusResponse {
  expiresAt: string;
  status: 'pending';
}

export interface CliLoginAuthenticatedStatusResponse {
  expiresAt: string;
  status: 'authenticated';
}

export interface CliLoginExpiredStatusResponse {
  expiresAt: string;
  status: 'expired';
}

export interface CliLoginExchangedStatusResponse {
  expiresAt: string;
  status: 'exchanged';
}

export type CliLoginStatusResponse =
  | CliLoginPendingStatusResponse
  | CliLoginAuthenticatedStatusResponse
  | CliLoginExpiredStatusResponse
  | CliLoginExchangedStatusResponse;

export interface CliLoginExchangeRequest {
  attemptId: string;
  exchangeSecret: string;
}

export type CliLoginExchangeResponse = LoginTokenResponse;

export interface ActivateTokenResponse {
  organizations: OrganizationSummary[];
  principal: PrincipalSummary;
  redirectTo?: undefined;
  sessionToken: string;
}

export interface ActivateCookieResponse {
  organizations: OrganizationSummary[];
  principal: PrincipalSummary;
  redirectTo: string;
  sessionToken?: undefined;
}

export type ActivateResponse = ActivateTokenResponse | ActivateCookieResponse;

export interface LoginEmailEntryStateResponse {
  email?: undefined;
  flowTarget: AppAccessBrowserFlowTarget | null;
  localPasswordEnabled?: undefined;
  organizationChoices?: undefined;
  organizationSlug?: undefined;
  principalEmail?: string | undefined;
  redirectTo?: undefined;
  ssoOptions?: undefined;
  view: 'email_entry';
}

export interface LoginMethodsStateResponse {
  email?: string | undefined;
  flowTarget: AppAccessBrowserFlowTarget | null;
  localPasswordEnabled: boolean;
  organizationChoices?: undefined;
  organizationSlug?: string | undefined;
  principalEmail?: string | undefined;
  redirectTo?: undefined;
  ssoOptions: LoginSsoProviderOption[];
  view: 'methods';
}

export interface LoginOrganizationSelectionStateResponse {
  email: string;
  flowTarget: AppAccessBrowserFlowTarget | null;
  localPasswordEnabled?: undefined;
  organizationChoices: LoginOrganizationChoice[];
  organizationSlug?: undefined;
  principalEmail?: string | undefined;
  redirectTo?: undefined;
  ssoOptions?: undefined;
  view: 'organization_selection';
}

export interface LoginRedirectStateResponse {
  email?: undefined;
  flowTarget: AppAccessBrowserFlowTarget | null;
  localPasswordEnabled?: undefined;
  organizationChoices?: undefined;
  organizationSlug?: undefined;
  principalEmail?: string | undefined;
  redirectTo: string;
  ssoOptions?: undefined;
  view: 'redirect';
}

export type LoginStateResponse =
  | LoginEmailEntryStateResponse
  | LoginMethodsStateResponse
  | LoginOrganizationSelectionStateResponse
  | LoginRedirectStateResponse;

export type ActivateStateQuery = AuthTokenStateQuery;

export type ActivateUnavailableReason = 'local_password_disabled';

export interface ActivateStateResponse extends AuthTokenStateResponse {
  unavailableReason?: ActivateUnavailableReason | undefined;
}

export interface LogoutResponse {
  success: true;
}

export interface WhoAmIQuery {
  environmentName?: string | undefined;
  projectName?: string | undefined;
}

export interface WhoAmIResponse {
  currentOrganization: OrganizationSummary | null;
  currentOrganizationPermissions: PermissionKey[];
  principal: PrincipalSummary;
}

export interface WhoAmICommandResponse {
  apiUrl: string;
  currentOrganization: OrganizationSummary | null;
  principal: PrincipalSummary;
  remoteName: string;
}
