export interface OrganizationAuthSettingsResult {
  localPasswordEnabled: boolean;
}

export interface UpdateOrganizationAuthSettingsInput {
  actorPrincipalId: string;
  localPasswordEnabled: boolean;
  organizationId: string;
  organizationSlug: string;
}

export interface AuthSessionOrganizationPolicySession {
  authMethodKind: 'oidc' | 'password' | 'password_scoped';
  oidcProviderId: string | null;
  organizationId: string | null;
  principalId: string;
}

export interface AuthSessionOrganizationPolicyInput {
  organizationId: string;
  session: AuthSessionOrganizationPolicySession;
}
