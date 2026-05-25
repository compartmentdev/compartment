import type {
  SsoOidcIdentityVerificationConfig,
  SsoOidcProviderPreset,
  SsoOidcProvisioningPolicy,
} from '@compartment/contracts';

export interface SsoOidcProviderRow {
  buttonText: string;
  clientId: string;
  clientSecretCiphertext: string;
  clientSecretEncryptionKeyId: string;
  createdAt: Date;
  displayName: string;
  id: string;
  identityVerification: SsoOidcIdentityVerificationConfig;
  issuerUrl: string;
  key: string;
  organizationId: string;
  preset: SsoOidcProviderPreset;
  provisioning: SsoOidcProvisioningPolicy;
  scope: string;
  updatedAt: Date;
}

export interface PersistedSsoOidcProviderRow extends Omit<
  SsoOidcProviderRow,
  'identityVerification' | 'preset' | 'provisioning'
> {
  identityVerificationJson: string;
  preset: string;
  provisioningPolicyJson: string;
}

export interface CreateSsoOidcProviderInput {
  buttonText: string;
  clientId: string;
  clientSecretCiphertext: string;
  clientSecretEncryptionKeyId: string;
  displayName: string;
  id: string;
  identityVerificationJson: string;
  issuerUrl: string;
  key: string;
  organizationId: string;
  preset: SsoOidcProviderPreset;
  provisioningPolicyJson: string;
  scope: string;
  updatedAt: Date;
}

export interface DeleteSsoOidcProviderInput {
  organizationId: string;
  providerId: string;
}

export type DeleteSsoOidcProviderResult = 'deleted' | 'login_method_required' | 'not_found';

export interface UpdateSsoOidcProviderInput {
  buttonText: string;
  clientId: string;
  clientSecretCiphertext: string;
  clientSecretEncryptionKeyId: string;
  displayName: string;
  identityVerificationJson: string;
  issuerUrl: string;
  key: string;
  preset: SsoOidcProviderPreset;
  providerId: string;
  provisioningPolicyJson: string;
  scope: string;
  updatedAt: Date;
}

export interface SsoOidcFlowRow {
  cliLoginAttemptId: string | null;
  consumedAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
  flowHost: string | null;
  flowPath: string | null;
  flowState: string | null;
  id: string;
  nonce: string;
  oidcState: string;
  pkceCodeVerifier: string;
  providerId: string;
  stateHash: string;
}

export interface CreateSsoOidcFlowInput {
  cliLoginAttemptId: string | null;
  expiresAt: Date;
  flowHost: string | null;
  flowPath: string | null;
  flowState: string | null;
  id: string;
  nonce: string;
  oidcState: string;
  pkceCodeVerifier: string;
  providerId: string;
  stateHash: string;
}

export interface SsoOidcPrincipalRow {
  principalEmail: string;
  principalId: string;
  principalType: string;
}

export interface SsoOidcIdentityRow {
  id: string;
  lastLoginAt: Date | null;
  principalId: string;
  providerId: string;
  subject: string;
}

export interface LinkSsoOidcIdentityInput {
  id: string;
  lastLoginAt: Date;
  principalId: string;
  providerId: string;
  subject: string;
}
