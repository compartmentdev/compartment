import { randomBytes } from 'node:crypto';
import { compartmentGitLabSourceWebhookPathnameTemplate } from '@compartment/contracts';
import { createGitLabTokenInvalidError, createGitSourceRegistrationFailedError } from '../../errors/api-business-error';
import { createId } from '../../lib/tokens';
import { encryptVariableValueForStorage, type EncryptedVariableValue } from '../../lib/variables-crypto';
import {
  createGitLabProviderRegistration as createRegistration,
  findActiveGitLabProviderRegistration,
  rotateGitLabProviderRegistrationToken,
} from '../../queries/gitlab-provider-registration.query';
import type {
  GitProviderRegistrationRow,
  GitProviderMutationTransaction,
} from '../../queries/git-provider-registration.query.types';
import { isUniqueConstraintError } from '../../queries/query-error';
import { getApiConfig, getApiDatabase } from '../../runtime/runtime-access';
import { isTrustedGitLabProviderHost } from '../outbound-http.service';
import { buildRuntimePublicSettings } from '../public-hosts.service';
import { isGitLabAuthenticationFailure } from './gitlab-http.adapter';
import { GitLabTokenValidationError, readGitLabTokenIdentity, type GitLabTokenIdentity } from './gitlab-user.adapter';
import type {
  CreateGitLabRegistrationInput,
  GitLabRegistrationSecrets,
  GitLabRegistrationView,
} from './gitlab-registration.service.types';

export async function createGitLabRegistration(input: CreateGitLabRegistrationInput): Promise<GitLabRegistrationView> {
  assertTrustedHost(input.request.providerHost);
  const identity: GitLabTokenIdentity = await readValidatedIdentity(
    input.request.providerHost,
    input.request.accessToken,
  );
  const existing: GitProviderRegistrationRow | undefined = await findActiveGitLabProviderRegistration({
    organizationId: input.organizationId,
    providerHost: input.request.providerHost,
    providerAccountId: identity.userId,
  });
  const registration: GitProviderRegistrationRow =
    existing === undefined
      ? await persistNewRegistrationOrRotateAfterRace(input, identity)
      : await rotateRegistration(input, existing, identity);
  return toRegistrationView(registration, identity.expiresAt);
}

async function persistNewRegistrationOrRotateAfterRace(
  input: CreateGitLabRegistrationInput,
  identity: GitLabTokenIdentity,
): Promise<GitProviderRegistrationRow> {
  try {
    return await persistNewRegistration(input, identity);
  } catch (error) {
    if (!isUniqueConstraintError(error instanceof Error ? error : undefined)) {
      throw error;
    }
    const raced: GitProviderRegistrationRow | undefined = await findActiveGitLabProviderRegistration({
      organizationId: input.organizationId,
      providerHost: input.request.providerHost,
      providerAccountId: identity.userId,
    });
    if (raced === undefined) {
      throw error;
    }
    return await rotateRegistration(input, raced, identity);
  }
}

async function persistNewRegistration(
  input: CreateGitLabRegistrationInput,
  identity: GitLabTokenIdentity,
): Promise<GitProviderRegistrationRow> {
  const id: string = createId('gpr');
  const compartmentUrl: string = buildRuntimePublicSettings(getApiConfig()).compartmentUrl;
  const secrets: GitLabRegistrationSecrets = encryptRegistrationSecrets(input.request.accessToken);
  return await getApiDatabase().transaction(
    async (transaction: GitProviderMutationTransaction): Promise<GitProviderRegistrationRow> =>
      await createRegistration(transaction, {
        ...secrets,
        callbackUrl: compartmentUrl,
        createdByPrincipalId: input.actorPrincipalId,
        id,
        accessTokenExpiresAt: identity.expiresAt,
        organizationId: input.organizationId,
        providerAccountId: identity.userId,
        providerAccountLogin: identity.username,
        providerHost: input.request.providerHost,
        repositoryOwner: identity.username,
        updatedAt: new Date(),
        webhookUrl: buildWebhookUrl(compartmentUrl, input.organizationId, id),
      }),
  );
}

async function rotateRegistration(
  input: CreateGitLabRegistrationInput,
  existing: GitProviderRegistrationRow,
  identity: GitLabTokenIdentity,
): Promise<GitProviderRegistrationRow> {
  const encrypted: EncryptedVariableValue = encryptVariableValueForStorage(
    input.request.accessToken,
    getApiConfig().variablesMasterKey,
  );
  return await getApiDatabase().transaction(
    async (transaction: GitProviderMutationTransaction): Promise<GitProviderRegistrationRow> =>
      await rotateGitLabProviderRegistrationToken(transaction, {
        accessTokenCiphertext: encrypted.valueCiphertext,
        accessTokenEncryptionKeyId: encrypted.encryptionKeyId,
        accessTokenExpiresAt: identity.expiresAt,
        organizationId: input.organizationId,
        registrationId: existing.id,
        providerAccountLogin: identity.username,
        updatedAt: new Date(),
      }),
  );
}

async function readValidatedIdentity(providerHost: string, token: string): Promise<GitLabTokenIdentity> {
  try {
    return await readGitLabTokenIdentity(providerHost, token);
  } catch (error) {
    if (error instanceof GitLabTokenValidationError) {
      throw createGitLabTokenInvalidError(error.message);
    }
    if (isGitLabAuthenticationFailure(error instanceof Error ? error : undefined)) {
      throw createGitLabTokenInvalidError('Re-enter an active GitLab personal access token with the api scope.');
    }
    throw error;
  }
}

function encryptRegistrationSecrets(token: string): GitLabRegistrationSecrets {
  const webhookSecret: string = randomBytes(32).toString('hex');
  const encryptedToken: EncryptedVariableValue = encryptVariableValueForStorage(
    token,
    getApiConfig().variablesMasterKey,
  );
  const encryptedWebhook: EncryptedVariableValue = encryptVariableValueForStorage(
    webhookSecret,
    getApiConfig().variablesMasterKey,
  );
  return {
    accessTokenCiphertext: encryptedToken.valueCiphertext,
    accessTokenEncryptionKeyId: encryptedToken.encryptionKeyId,
    webhookSecretCiphertext: encryptedWebhook.valueCiphertext,
    webhookSecretEncryptionKeyId: encryptedWebhook.encryptionKeyId,
  };
}

function buildWebhookUrl(compartmentUrl: string, organizationId: string, registrationId: string): string {
  const pathname: string = compartmentGitLabSourceWebhookPathnameTemplate
    .replace(':organizationId', encodeURIComponent(organizationId))
    .replace(':registrationId', encodeURIComponent(registrationId));
  return new URL(pathname, `${compartmentUrl}/`).toString();
}

function assertTrustedHost(providerHost: string): void {
  if (!isTrustedGitLabProviderHost(providerHost)) {
    throw createGitSourceRegistrationFailedError(
      `GitLab provider host ${providerHost} must be listed in COMPARTMENT_TRUSTED_OUTBOUND_HOSTS.`,
    );
  }
}

function toRegistrationView(registration: GitProviderRegistrationRow, expiresAt: Date | null): GitLabRegistrationView {
  if (registration.providerAccountLogin === null) {
    throw new Error('Active GitLab registration is missing provider_account_login.');
  }
  return {
    createdAt: registration.createdAt.toISOString(),
    expiresAt: expiresAt?.toISOString() ?? null,
    providerAccountLogin: registration.providerAccountLogin,
    providerHost: registration.providerHost,
    providerType: 'gitlab',
    registrationId: registration.id,
  };
}
