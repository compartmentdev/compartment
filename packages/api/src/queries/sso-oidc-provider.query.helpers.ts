import {
  ssoOidcIdentityVerificationConfigSchema,
  ssoOidcProvisioningPolicySchema,
  type SsoOidcIdentityVerificationConfig,
  type SsoOidcProvisioningPolicy,
} from '@compartment/contracts';
import type { PersistedSsoOidcProviderRow, SsoOidcProviderRow } from './sso-oidc.query.types';

export function mapSsoOidcProviderRow(row: PersistedSsoOidcProviderRow | undefined): SsoOidcProviderRow | undefined {
  if (row === undefined) {
    return undefined;
  }
  if (row.preset !== 'generic' && row.preset !== 'google') {
    throw new Error(`Stored SSO OIDC provider preset "${row.preset}" is not supported.`);
  }

  return {
    ...row,
    identityVerification: parseSsoOidcIdentityVerification(row.identityVerificationJson),
    preset: row.preset,
    provisioning: parseSsoOidcProvisioningPolicy(row.provisioningPolicyJson),
  };
}

export function requireSsoOidcProvider(provider: SsoOidcProviderRow | undefined): SsoOidcProviderRow {
  if (provider === undefined) {
    throw new Error('Failed to persist SSO OIDC provider.');
  }

  return provider;
}

function parseSsoOidcIdentityVerification(value: string): SsoOidcIdentityVerificationConfig {
  try {
    return ssoOidcIdentityVerificationConfigSchema.parse(JSON.parse(value));
  } catch {
    throw new Error('Stored SSO OIDC identity verification config is invalid.');
  }
}

function parseSsoOidcProvisioningPolicy(value: string): SsoOidcProvisioningPolicy {
  try {
    return ssoOidcProvisioningPolicySchema.parse(JSON.parse(value));
  } catch {
    throw new Error('Stored SSO OIDC provisioning policy is invalid.');
  }
}
