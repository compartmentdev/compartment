import {
  buildCompartmentGitHubProviderBootstrapStartPathname,
  compartmentGitHubSourceWebhookPathnameTemplate,
} from '@compartment/contracts';
import { createGitSourceRegistrationFailedError } from '../../errors/api-business-error';
import { createId } from '../../lib/tokens';
import { encryptVariableValueForStorage, type EncryptedVariableValue } from '../../lib/variables-crypto';
import type { GitProviderRegistrationRow } from '../../queries/git-provider-registration.query.types';
import type { GitHubProviderBootstrapView, GitHubBootstrapViewStatus } from './git-source.service.types';

export type GitHubBootstrapStatus = GitHubBootstrapViewStatus;

export interface PendingGitHubBootstrapMaterial {
  callbackUrl: string;
  expiresAt: Date;
  registrationId: string;
  stateId: string;
  stateNonce: string;
  webhookUrl: string;
}

export interface GitHubManifestSecrets {
  privateKeyPemCiphertext: string;
  privateKeyPemEncryptionKeyId: string;
  webhookSecretCiphertext: string;
  webhookSecretEncryptionKeyId: string;
}

interface BuildPendingGitHubBootstrapMaterialInput {
  callbackPathname: string;
  compartmentUrl: string;
  now: Date;
  organizationId: string;
  ttlMs: number;
}

export function buildPendingGitHubBootstrapMaterial(
  input: BuildPendingGitHubBootstrapMaterialInput,
): PendingGitHubBootstrapMaterial {
  const registrationId: string = createId('gpr');
  return buildPendingGitHubBootstrapMaterialForRegistration(input, {
    callbackUrl: new URL(input.callbackPathname, `${input.compartmentUrl}/`).toString(),
    registrationId,
    webhookUrl: new URL(
      buildGitHubSourceWebhookPathname(input.organizationId, registrationId),
      `${input.compartmentUrl}/`,
    ).toString(),
  });
}

export function buildPendingGitHubBootstrapMaterialForRegistration(
  input: BuildPendingGitHubBootstrapMaterialInput,
  registration: Pick<PendingGitHubBootstrapMaterial, 'callbackUrl' | 'registrationId' | 'webhookUrl'>,
): PendingGitHubBootstrapMaterial {
  const stateId: string = createId('gps');
  const stateNonce: string = createId('gst');
  const expiresAt: Date = new Date(input.now.getTime() + input.ttlMs);
  return {
    callbackUrl: registration.callbackUrl,
    expiresAt,
    registrationId: registration.registrationId,
    stateId,
    stateNonce,
    webhookUrl: registration.webhookUrl,
  };
}

export function buildPendingGitHubBootstrapView(
  compartmentUrl: string,
  registration: GitProviderRegistrationRow,
): GitHubProviderBootstrapView {
  const bootstrapStateId: string = requireBootstrapStateId(registration);
  return buildGitHubBootstrapView(
    registration.id,
    registration.providerHost,
    registration.repositoryOwner,
    null,
    null,
    'pending',
    bootstrapStateId,
    buildGitHubBootstrapBrowserUrl(compartmentUrl, bootstrapStateId),
  );
}

export function buildGitHubBootstrapView(
  registrationId: string,
  providerHost: string,
  repositoryOwner: string,
  installationAccountLogin: string | null,
  installationId: string | null,
  status: GitHubBootstrapStatus,
  bootstrapStateId: string | null,
  browserUrl: string | null,
): GitHubProviderBootstrapView {
  return {
    bootstrapStateId,
    browserUrl,
    installationAccountLogin,
    installationId,
    providerHost,
    registrationId,
    repositoryOwner,
    status,
  };
}

export function buildGitHubBootstrapBrowserUrl(compartmentUrl: string, stateId: string): string {
  return new URL(buildCompartmentGitHubProviderBootstrapStartPathname(stateId), `${compartmentUrl}/`).toString();
}

export function encryptGitHubManifestSecrets(
  privateKeyPem: string,
  webhookSecret: string,
  masterKey: Buffer,
): GitHubManifestSecrets {
  const encryptedPrivateKey: EncryptedVariableValue = encryptVariableValueForStorage(privateKeyPem, masterKey);
  const encryptedWebhookSecret: EncryptedVariableValue = encryptVariableValueForStorage(webhookSecret, masterKey);

  return {
    privateKeyPemCiphertext: encryptedPrivateKey.valueCiphertext,
    privateKeyPemEncryptionKeyId: encryptedPrivateKey.encryptionKeyId,
    webhookSecretCiphertext: encryptedWebhookSecret.valueCiphertext,
    webhookSecretEncryptionKeyId: encryptedWebhookSecret.encryptionKeyId,
  };
}

export function readGitHubBootstrapStatus(status: string): GitHubBootstrapStatus {
  if (status === 'active' || status === 'failed' || status === 'pending') {
    return status;
  }

  throw new Error(`Unsupported git provider registration status "${status}".`);
}

function requireBootstrapStateId(registration: GitProviderRegistrationRow): string {
  if (registration.bootstrapStateId === null) {
    throw createGitSourceRegistrationFailedError();
  }

  return registration.bootstrapStateId;
}

function buildGitHubSourceWebhookPathname(organizationId: string, registrationId: string): string {
  return compartmentGitHubSourceWebhookPathnameTemplate
    .replace(':organizationId', encodeURIComponent(organizationId))
    .replace(':registrationId', encodeURIComponent(registrationId));
}
