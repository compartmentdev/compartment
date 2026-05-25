import {
  type SsoOidcIdentityClaimExpectedValue,
  type SsoOidcIdentityClaimReference,
  type SsoOidcIdentityClaimSource,
  type SsoOidcIdentityVerificationConfig,
  type SsoOidcIdentityVerifiedClaimReference,
} from '@compartment/contracts';
import { hasText } from '@compartment/utils';
import { splitCommaSeparatedValues } from '../comma-separated-values.command.helpers';

export interface SsoOidcIdentityVerificationCommandOptions {
  emailClaims?: string | undefined;
  emailVerifiedClaims?: string | undefined;
  verifiedEmailClaims?: string | undefined;
}

interface ParsedClaimReference {
  claim: string;
  source: SsoOidcIdentityClaimSource;
}

export function buildSsoOidcIdentityVerificationConfig(
  options: SsoOidcIdentityVerificationCommandOptions,
): SsoOidcIdentityVerificationConfig | undefined {
  if (
    options.emailClaims === undefined &&
    options.emailVerifiedClaims === undefined &&
    options.verifiedEmailClaims === undefined
  ) {
    return undefined;
  }

  return {
    emailClaims: parseClaimReferences(options.emailClaims),
    emailVerifiedClaims: parseVerifiedClaimReferences(options.emailVerifiedClaims),
    verifiedEmailClaims: parseClaimReferences(options.verifiedEmailClaims),
  };
}

function parseClaimReferences(value: string | undefined): SsoOidcIdentityClaimReference[] {
  return splitCommaSeparatedValues(value).map(
    (claimReference: string): SsoOidcIdentityClaimReference => parseClaimReference(claimReference),
  );
}

function parseVerifiedClaimReferences(value: string | undefined): SsoOidcIdentityVerifiedClaimReference[] {
  return splitCommaSeparatedValues(value).map(
    (claimReference: string): SsoOidcIdentityVerifiedClaimReference => parseVerifiedClaimReference(claimReference),
  );
}

function parseVerifiedClaimReference(value: string): SsoOidcIdentityVerifiedClaimReference {
  const [claimReference, rawExpectedValue] = splitExpectedValue(value);
  const parsedClaimReference: ParsedClaimReference = parseClaimReference(claimReference);

  return {
    ...parsedClaimReference,
    equals: parseExpectedValue(rawExpectedValue),
  };
}

function parseClaimReference(value: string): SsoOidcIdentityClaimReference {
  const [source, claim] = parseClaimReferenceParts(value);

  return { claim, source };
}

function parseClaimReferenceParts(value: string): [SsoOidcIdentityClaimSource, string] {
  const separatorIndex: number = value.indexOf(':');
  const rawSource: string | undefined = separatorIndex === -1 ? undefined : value.slice(0, separatorIndex);
  const claim: string | undefined = separatorIndex === -1 ? undefined : value.slice(separatorIndex + 1);
  const source: SsoOidcIdentityClaimSource | null = readClaimSource(rawSource);
  if (source === null || !hasText(claim)) {
    throw new Error(`Invalid OIDC claim reference "${value}". Use id-token:claim, id_token:claim, or userinfo:claim.`);
  }

  return [source, claim];
}

function splitExpectedValue(value: string): [string, string | undefined] {
  const equalsIndex: number = value.indexOf('=');
  if (equalsIndex === -1) {
    return [value, undefined];
  }

  return [value.slice(0, equalsIndex), value.slice(equalsIndex + 1)];
}

function readClaimSource(value: string | undefined): SsoOidcIdentityClaimSource | null {
  if (value === 'id-token' || value === 'id_token') {
    return 'id_token';
  }
  if (value === 'userinfo') {
    return 'userinfo';
  }

  return null;
}

function parseExpectedValue(value: string | undefined): SsoOidcIdentityClaimExpectedValue | undefined {
  let expectedValue: SsoOidcIdentityClaimExpectedValue | undefined;
  if (value === 'true') {
    expectedValue = true;
  } else if (value === 'false') {
    expectedValue = false;
  } else if (hasText(value) && Number.isFinite(Number(value))) {
    expectedValue = Number(value);
  } else {
    expectedValue = value;
  }

  return expectedValue;
}
