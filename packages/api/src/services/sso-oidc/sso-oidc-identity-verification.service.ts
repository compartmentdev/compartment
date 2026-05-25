import { hasText } from '@compartment/utils';
import type {
  SsoOidcIdentityClaimExpectedValue,
  SsoOidcIdentityClaimReference,
  SsoOidcIdentityClaimSource,
  SsoOidcIdentityVerificationConfig,
  SsoOidcIdentityVerifiedClaimReference,
} from '@compartment/contracts';
import type { JsonValue } from 'openid-client';
import { createInvalidSsoLoginError } from '../../errors/api-business-error';
import type { OidcIdentityClaims } from './sso-oidc-client.adapter.types';
import type {
  OidcClaimSet,
  OidcIdentityClaimSources,
  OidcResolvedEmailClaim,
} from './sso-oidc-identity-verification.service.types';

export function resolveOidcIdentityClaims(
  sources: OidcIdentityClaimSources,
  identityVerification: SsoOidcIdentityVerificationConfig,
): OidcIdentityClaims {
  const emailClaim: OidcResolvedEmailClaim | null = resolveEmailClaim(sources, identityVerification);

  return {
    email: emailClaim?.value ?? null,
    emailVerified: emailClaim === null ? false : isEmailVerified(emailClaim, sources, identityVerification),
    issuer: readRequiredStringClaim(sources.idToken, 'iss'),
    subject: readRequiredStringClaim(sources.idToken, 'sub'),
  };
}

function resolveEmailClaim(
  sources: OidcIdentityClaimSources,
  identityVerification: SsoOidcIdentityVerificationConfig,
): OidcResolvedEmailClaim | null {
  return (
    readFirstEmailClaim(sources, identityVerification.verifiedEmailClaims, true) ??
    readFirstEmailClaim(sources, identityVerification.emailClaims, false)
  );
}

function readFirstEmailClaim(
  sources: OidcIdentityClaimSources,
  claimReferences: SsoOidcIdentityClaimReference[],
  verified: boolean,
): OidcResolvedEmailClaim | null {
  for (const claimReference of claimReferences) {
    const value: string | null = readEmailClaim(sources, claimReference);
    if (value !== null) {
      return {
        source: claimReference.source,
        value,
        verified,
      };
    }
  }

  return null;
}

function isEmailVerified(
  emailClaim: OidcResolvedEmailClaim,
  sources: OidcIdentityClaimSources,
  identityVerification: SsoOidcIdentityVerificationConfig,
): boolean {
  return (
    emailClaim.verified ||
    hasVerifiedEmailClaim(emailClaim.value, sources, identityVerification.verifiedEmailClaims) ||
    hasEmailVerifiedClaim(
      emailClaim,
      sources,
      identityVerification.emailClaims,
      identityVerification.emailVerifiedClaims,
    )
  );
}

function hasVerifiedEmailClaim(
  email: string,
  sources: OidcIdentityClaimSources,
  claimReferences: SsoOidcIdentityClaimReference[],
): boolean {
  return claimReferences.some((claimReference: SsoOidcIdentityClaimReference): boolean => {
    const value: string | null = readEmailClaim(sources, claimReference);

    return value !== null && isSameEmail(value, email);
  });
}

function hasEmailVerifiedClaim(
  emailClaim: OidcResolvedEmailClaim,
  sources: OidcIdentityClaimSources,
  emailClaimReferences: SsoOidcIdentityClaimReference[],
  emailVerifiedClaimReferences: SsoOidcIdentityVerifiedClaimReference[],
): boolean {
  return emailVerifiedClaimReferences.some((claimReference: SsoOidcIdentityVerifiedClaimReference): boolean => {
    if (!matchesExpectedClaimValue(readClaimValue(sources, claimReference), claimReference.equals)) {
      return false;
    }

    return (
      claimReference.source === emailClaim.source ||
      hasMatchingEmailClaimForSource(emailClaim.value, sources, emailClaimReferences, claimReference.source)
    );
  });
}

function hasMatchingEmailClaimForSource(
  email: string,
  sources: OidcIdentityClaimSources,
  claimReferences: SsoOidcIdentityClaimReference[],
  source: SsoOidcIdentityClaimSource,
): boolean {
  return claimReferences.some((claimReference: SsoOidcIdentityClaimReference): boolean => {
    if (claimReference.source !== source) {
      return false;
    }

    const value: string | null = readEmailClaim(sources, claimReference);

    return value !== null && isSameEmail(value, email);
  });
}

function matchesExpectedClaimValue(
  value: JsonValue | undefined,
  expectedValue: SsoOidcIdentityClaimExpectedValue | undefined,
): boolean {
  return expectedValue === undefined ? value === true : value === expectedValue;
}

function readEmailClaim(
  sources: OidcIdentityClaimSources,
  claimReference: SsoOidcIdentityClaimReference,
): string | null {
  const value: string | null = readStringClaim(readClaimValue(sources, claimReference));
  return value?.includes('@') === true ? value : null;
}

function readClaimValue(
  sources: OidcIdentityClaimSources,
  claimReference: SsoOidcIdentityClaimReference,
): JsonValue | undefined {
  const claims: OidcClaimSet | undefined = claimReference.source === 'id_token' ? sources.idToken : sources.userinfo;

  return claims?.[claimReference.claim];
}

function readRequiredStringClaim(claims: OidcClaimSet, claimName: string): string {
  const value: string | null = readStringClaim(claims[claimName]);
  if (value === null) {
    throw createInvalidSsoLoginError();
  }

  return value;
}

function readStringClaim(value: JsonValue | undefined): string | null {
  if (typeof value === 'string' && hasText(value)) {
    return value;
  }

  return null;
}

function isSameEmail(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
