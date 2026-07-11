import { randomBytes } from 'node:crypto';
import { compartmentGitLabSourceWebhookPathnameTemplate } from '@compartment/contracts';
import { createGitLabTokenInvalidError, createGitSourceRegistrationFailedError } from '../../errors/api-business-error';
import { createId } from '../../lib/tokens';
import { encryptVariableValueForStorage, type EncryptedVariableValue } from '../../lib/variables-crypto';
import {
  createGitLabProviderRegistration as createRegistration,
  findActiveGitLabProviderRegistration,
  listActiveGitLabProviderRegistrations,
  rotateGitLabProviderRegistrationToken,
} from '../../queries/gitlab-provider-registration.query';
import type { GitProviderRegistrationRow } from '../../queries/git-provider-registration.query.types';
import { findGitProviderRegistrationById } from '../../queries/git-provider-registration.query';
import { getApiConfig, getApiDatabase } from '../../runtime/runtime-access';
import { isTrustedGitLabProviderHost } from '../outbound-http.service';
import { buildRuntimePublicSettings } from '../public-hosts.service';
import { isGitLabAuthenticationFailure } from './gitlab-http.adapter';
import { readGitLabUser } from './gitlab-user.adapter';
import { buildGitProviderAccess } from './git-source-provider-access.service';
import { gitlabProviderAdapter } from './gitlab-provider.adapter';
import type { GitRepositorySummary } from './git-source-provider.types';
import type {
  CreateGitLabRegistrationInput,
  GitLabRegistrationSecrets,
  GitLabRegistrationView,
} from './gitlab-registration.service.types';

export async function createGitLabRegistration(input: CreateGitLabRegistrationInput): Promise<GitLabRegistrationView> {
  assertTrustedHost(input.request.providerHost);
  const username: string = await readValidatedUsername(input.request.providerHost, input.request.accessToken);
  const existing: GitProviderRegistrationRow | undefined = await findActiveGitLabProviderRegistration(
    input.organizationId,
    input.request.providerHost,
    username,
  );
  const registration: GitProviderRegistrationRow =
    existing === undefined ? await persistNewRegistration(input, username) : await rotateRegistration(input, existing);
  return toRegistrationView(registration);
}

export async function listGitLabRegistrations(organizationId: string): Promise<GitLabRegistrationView[]> {
  return (await listActiveGitLabProviderRegistrations(organizationId)).map(toRegistrationView);
}

export async function listGitLabRegistrationRepositories(
  organizationId: string,
  registrationId: string,
): Promise<GitRepositorySummary[]> {
  const registration: GitProviderRegistrationRow | undefined = await findGitProviderRegistrationById({
    organizationId,
    registrationId,
  });
  if (registration?.providerType !== 'gitlab' || registration.status !== 'active') {
    throw createGitSourceRegistrationFailedError('The GitLab provider registration is not active.');
  }
  try {
    return await gitlabProviderAdapter.listRegistrationRepositories(buildGitProviderAccess(registration));
  } catch (error) {
    if (gitlabProviderAdapter.isAuthenticationFailure(error instanceof Error ? error : undefined)) {
      throw createGitLabTokenInvalidError('Re-enter the GitLab token and ensure it has the api scope.');
    }
    throw error;
  }
}

async function persistNewRegistration(
  input: CreateGitLabRegistrationInput,
  username: string,
): Promise<GitProviderRegistrationRow> {
  const id: string = createId('gpr');
  const compartmentUrl: string = buildRuntimePublicSettings(getApiConfig()).compartmentUrl;
  const secrets: GitLabRegistrationSecrets = encryptRegistrationSecrets(input.request.accessToken);
  return await createRegistration(getApiDatabase(), {
    ...secrets,
    callbackUrl: compartmentUrl,
    createdByPrincipalId: input.actorPrincipalId,
    id,
    installationAccountLogin: username,
    installationAccountType: 'User',
    organizationId: input.organizationId,
    providerHost: input.request.providerHost,
    repositoryOwner: username,
    updatedAt: new Date(),
    webhookUrl: buildWebhookUrl(compartmentUrl, input.organizationId, id),
  });
}

async function rotateRegistration(
  input: CreateGitLabRegistrationInput,
  existing: GitProviderRegistrationRow,
): Promise<GitProviderRegistrationRow> {
  const encrypted: EncryptedVariableValue = encryptVariableValueForStorage(
    input.request.accessToken,
    getApiConfig().variablesMasterKey,
  );
  return await rotateGitLabProviderRegistrationToken(
    getApiDatabase(),
    existing.id,
    input.organizationId,
    encrypted.valueCiphertext,
    encrypted.encryptionKeyId,
    new Date(),
  );
}

async function readValidatedUsername(providerHost: string, token: string): Promise<string> {
  try {
    return (await readGitLabUser(providerHost, token)).username;
  } catch (error) {
    if (isGitLabAuthenticationFailure(error instanceof Error ? error : undefined)) {
      throw createGitLabTokenInvalidError('Re-enter the GitLab token and ensure it has the api scope.');
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

function toRegistrationView(registration: GitProviderRegistrationRow): GitLabRegistrationView {
  return {
    createdAt: registration.createdAt.toISOString(),
    providerHost: registration.providerHost,
    registrationId: registration.id,
    tokenHolderLogin: registration.repositoryOwner,
  };
}
