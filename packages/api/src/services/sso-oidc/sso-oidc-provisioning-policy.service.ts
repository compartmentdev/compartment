import {
  buildDisabledSsoOidcProvisioningPolicy,
  type EnabledSsoOidcProvisioningPolicy,
  type SsoOidcProvisioningPolicy,
} from '@compartment/contracts';
import { hasText } from '@compartment/utils';
import { createInvalidSsoLoginError, createInvalidSsoProviderConfigError } from '../../errors/api-business-error';
import type { OidcIdentityClaims } from './sso-oidc-client.adapter.types';

const ssoOidcProvisioningDomainLabelPattern: RegExp = /^[a-z0-9-]+$/u;

export function readSsoOidcProvisioningPolicy(
  provisioning: SsoOidcProvisioningPolicy | undefined,
): SsoOidcProvisioningPolicy {
  if (provisioning === undefined) {
    return buildDisabledSsoOidcProvisioningPolicy();
  }
  if (!provisioning.autoJoinEnabled) {
    return provisioning;
  }

  return {
    allowedEmailDomains: normalizeAllowedEmailDomains(provisioning.allowedEmailDomains),
    autoJoinEnabled: true,
    defaultRole: provisioning.defaultRole,
  };
}

export function canAutoJoinWithSsoOidcClaims(
  provisioning: SsoOidcProvisioningPolicy,
  claims: OidcIdentityClaims,
): boolean {
  if (!provisioning.autoJoinEnabled) {
    return false;
  }

  let verifiedEmail: string;
  try {
    verifiedEmail = requireVerifiedEmailForSsoOidcClaims(claims);
  } catch {
    return false;
  }

  const normalizedEmailDomain: string = readNormalizedEmailDomain(verifiedEmail);

  return provisioning.allowedEmailDomains.includes(normalizedEmailDomain);
}

export function requireVerifiedEmailForSsoOidcClaims(claims: OidcIdentityClaims): string {
  if (!claims.emailVerified || !hasText(claims.email)) {
    throw createInvalidSsoLoginError();
  }

  return claims.email;
}

export function requireEnabledSsoOidcProvisioningPolicy(
  provisioning: SsoOidcProvisioningPolicy,
): EnabledSsoOidcProvisioningPolicy {
  if (!provisioning.autoJoinEnabled) {
    throw createInvalidSsoLoginError();
  }

  return provisioning;
}

function normalizeAllowedEmailDomains(value: string[]): string[] {
  const normalizedDomains: string[] = [];

  for (const domain of value) {
    const normalizedDomain: string = normalizeConfiguredEmailDomain(domain);
    if (!normalizedDomains.includes(normalizedDomain)) {
      normalizedDomains.push(normalizedDomain);
    }
  }

  return normalizedDomains;
}

function readNormalizedEmailDomain(email: string): string {
  const atIndex: number = email.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === email.length - 1) {
    throw createInvalidSsoLoginError();
  }

  return normalizeLoginEmailDomain(email.slice(atIndex + 1));
}

function normalizeConfiguredEmailDomain(value: string): string {
  return normalizeEmailDomain(
    value,
    (): Error => createInvalidSsoProviderConfigError('OIDC auto-join domains must be valid email domains.'),
  );
}

function normalizeLoginEmailDomain(value: string): string {
  return normalizeEmailDomain(value, createInvalidSsoLoginError);
}

function normalizeEmailDomain(value: string, createError: () => Error): string {
  const normalizedValue: string = value.trim().toLowerCase();
  const labels: string[] = normalizedValue.split('.');
  if (
    !hasText(normalizedValue) ||
    normalizedValue.includes('@') ||
    labels.length < 2 ||
    labels.some((label: string): boolean => !isValidEmailDomainLabel(label))
  ) {
    throw createError();
  }

  return normalizedValue;
}

function isValidEmailDomainLabel(label: string): boolean {
  return (
    hasText(label) &&
    !label.startsWith('-') &&
    !label.endsWith('-') &&
    ssoOidcProvisioningDomainLabelPattern.test(label)
  );
}
