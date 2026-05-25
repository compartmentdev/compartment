import {
  buildDefaultSsoOidcIdentityVerificationConfig,
  type SsoOidcIdentityVerificationConfig,
  type SsoOidcProviderPreset,
  type SsoOidcProvisioningPolicy,
} from '@compartment/contracts';
import { hasText } from '@compartment/utils';
import { createInvalidSsoProviderConfigError } from '../../errors/api-business-error';
import { createId } from '../../lib/tokens';
import {
  decryptVariableValueFromStorage,
  encryptVariableValueForStorage,
  type EncryptedVariableValue,
} from '../../lib/variables-crypto';
import type {
  CreateSsoOidcProviderInput as CreateSsoOidcProviderQueryInput,
  SsoOidcProviderRow,
  UpdateSsoOidcProviderInput as UpdateSsoOidcProviderQueryInput,
} from '../../queries/sso-oidc.query.types';
import { getApiConfig } from '../../runtime/runtime-access';
import { isTrustedPublicOutboundHost } from '../outbound-http.service';
import type {
  CreateSsoOidcProviderInput,
  ResolvedUpdateSsoOidcProviderInput,
  SsoOidcProviderResult,
} from './sso-oidc.service.types';
import { readSsoOidcProvisioningPolicy } from './sso-oidc-provisioning-policy.service';

const googleIssuerUrl: string = 'https://accounts.google.com';
const defaultOidcScope: string = 'openid email profile';
const requiredOidcScope: string = 'openid';

interface SsoOidcProviderMutationConfig {
  buttonText: string;
  clientId: string;
  clientSecretCiphertext: string;
  clientSecretEncryptionKeyId: string;
  displayName: string;
  identityVerificationJson: string;
  issuerUrl: string;
  key: string;
  preset: SsoOidcProviderPreset;
  provisioningPolicyJson: string;
  scope: string;
  updatedAt: Date;
}

type SsoOidcProviderMutationInput = CreateSsoOidcProviderInput | ResolvedUpdateSsoOidcProviderInput;

export function buildCreateProviderInput(
  input: CreateSsoOidcProviderInput,
  providerId: string = createId('sop'),
): CreateSsoOidcProviderQueryInput {
  const config: SsoOidcProviderMutationConfig = buildProviderMutationConfig(input);

  return {
    ...config,
    id: providerId,
    organizationId: input.organizationId,
  };
}

export function buildUpdateProviderInput(input: ResolvedUpdateSsoOidcProviderInput): UpdateSsoOidcProviderQueryInput {
  return {
    ...buildProviderMutationConfig(input),
    providerId: input.providerId,
  };
}

export function toSsoOidcProviderResult(provider: SsoOidcProviderRow): SsoOidcProviderResult {
  return {
    buttonText: provider.buttonText,
    clientId: provider.clientId,
    createdAt: provider.createdAt,
    displayName: provider.displayName,
    id: provider.id,
    identityVerification: provider.identityVerification,
    issuerUrl: provider.issuerUrl,
    key: provider.key,
    preset: provider.preset,
    provisioning: provider.provisioning,
    scope: provider.scope,
    updatedAt: provider.updatedAt,
  };
}

export function hasSsoOidcProviderTrustConfigChanged(
  existingProvider: SsoOidcProviderRow,
  input: ResolvedUpdateSsoOidcProviderInput,
  identityNamespaceResetRequired: boolean,
): boolean {
  // Provisioning updates only affect future logins; revoke active sessions only when the trust boundary changes.
  return (
    identityNamespaceResetRequired ||
    readStoredClientSecret(existingProvider) !== input.clientSecret ||
    existingProvider.scope !== readScope(input.scope) ||
    serializeIdentityVerification(existingProvider.identityVerification) !==
      serializeIdentityVerification(readIdentityVerification(input.identityVerification))
  );
}

export function requiresIdentityNamespaceReset(
  existingProvider: SsoOidcProviderRow,
  input: ResolvedUpdateSsoOidcProviderInput,
): boolean {
  return (
    existingProvider.clientId !== input.clientId ||
    existingProvider.issuerUrl !== readIssuerUrl(input.preset, input.issuerUrl) ||
    existingProvider.preset !== input.preset
  );
}

function buildProviderMutationConfig(input: SsoOidcProviderMutationInput): SsoOidcProviderMutationConfig {
  const displayName: string = readDisplayName(input.preset, input.displayName);
  const encryptedSecret: EncryptedVariableValue = encryptSsoOidcProviderSecret(input.clientSecret);
  const identityVerification: SsoOidcIdentityVerificationConfig = readIdentityVerification(input.identityVerification);
  const provisioningPolicy: SsoOidcProvisioningPolicy = readSsoOidcProvisioningPolicy(input.provisioning);

  return {
    buttonText: readButtonText(displayName, input.buttonText),
    clientId: input.clientId,
    clientSecretCiphertext: encryptedSecret.valueCiphertext,
    clientSecretEncryptionKeyId: encryptedSecret.encryptionKeyId,
    displayName,
    identityVerificationJson: serializeIdentityVerification(identityVerification),
    issuerUrl: readIssuerUrl(input.preset, input.issuerUrl),
    key: readProviderKey(input.key),
    preset: input.preset,
    provisioningPolicyJson: serializeProvisioningPolicy(provisioningPolicy),
    scope: readScope(input.scope),
    updatedAt: new Date(),
  };
}

function encryptSsoOidcProviderSecret(clientSecret: string): EncryptedVariableValue {
  return encryptVariableValueForStorage(clientSecret, getApiConfig().variablesMasterKey);
}

export function readStoredClientSecret(provider: SsoOidcProviderRow): string {
  return decryptVariableValueFromStorage(
    provider.clientSecretCiphertext,
    provider.clientSecretEncryptionKeyId,
    getApiConfig().variablesMasterKey,
  );
}

function readButtonText(displayName: string, buttonText: string | undefined): string {
  if (hasText(buttonText)) {
    return buttonText;
  }

  return `Login with ${displayName}`;
}

function readDisplayName(preset: SsoOidcProviderPreset, displayName: string | undefined): string {
  if (hasText(displayName)) {
    return displayName;
  }
  if (preset === 'google') {
    return 'Google';
  }

  throw createInvalidSsoProviderConfigError('Generic OIDC providers require displayName.');
}

function readProviderKey(key: string): string {
  return key;
}

function readScope(scope: string | undefined): string {
  const scopeTokens: string[] = (scope ?? defaultOidcScope).split(/\s+/u).filter(hasText);
  if (!scopeTokens.includes(requiredOidcScope)) {
    throw createInvalidSsoProviderConfigError('OIDC provider scope must include openid.');
  }

  return scopeTokens.join(' ');
}

function readIdentityVerification(
  identityVerification: SsoOidcIdentityVerificationConfig | undefined,
): SsoOidcIdentityVerificationConfig {
  return identityVerification ?? buildDefaultSsoOidcIdentityVerificationConfig();
}

function serializeIdentityVerification(identityVerification: SsoOidcIdentityVerificationConfig): string {
  return JSON.stringify(identityVerification);
}

function serializeProvisioningPolicy(provisioningPolicy: SsoOidcProvisioningPolicy): string {
  return JSON.stringify(provisioningPolicy);
}

function readIssuerUrl(preset: SsoOidcProviderPreset, issuerUrl: string | undefined): string {
  const resolvedIssuerUrl: string | undefined = preset === 'google' ? googleIssuerUrl : issuerUrl;
  if (!hasText(resolvedIssuerUrl)) {
    throw createInvalidSsoProviderConfigError('Generic OIDC providers require issuerUrl.');
  }

  return normalizeIssuerUrl(resolvedIssuerUrl);
}

function normalizeIssuerUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw createInvalidSsoProviderConfigError('Issuer URL must be an absolute URL.');
  }

  if (url.protocol !== 'https:') {
    throw createInvalidSsoProviderConfigError('Issuer URL must use https.');
  }
  if (url.username !== '' || url.password !== '') {
    throw createInvalidSsoProviderConfigError('Issuer URL must not include credentials.');
  }
  assertTrustedIssuerUrl(url);

  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/$/u, '');
}

function assertTrustedIssuerUrl(url: URL): void {
  if (isTrustedPublicOutboundHost(url.host)) {
    return;
  }

  throw createInvalidSsoProviderConfigError(
    `OIDC issuer host ${url.host} must be listed in COMPARTMENT_TRUSTED_OUTBOUND_HOSTS.`,
  );
}
