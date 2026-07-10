import { hasText } from '@compartment/utils';
import {
  createGitSourceRegistrationFailedError,
  createGitSourceRegistrationPendingError,
  createGitSourceRequestInvalidError,
} from '../../errors/api-business-error';
import type { GitProviderRegistrationRow } from '../../queries/git-provider-registration.query.types';
import { requireGitProviderRegistration } from './git-source-bootstrap.read';
import { buildGitProviderAccess } from './git-source-provider-access.service';
import type { GitProviderAccess } from './git-source-provider.types';
import type { GitSourceContextInput } from './git-source.service.types';

interface GitProviderRegistrationAccessInput extends GitSourceContextInput {
  providerHost: string;
  registrationId: string;
  repositoryOwner: string;
}

export async function requireGitProviderRegistrationAccess(
  input: GitProviderRegistrationAccessInput,
): Promise<GitProviderAccess> {
  const registration: GitProviderRegistrationRow = await requireGitProviderRegistration({
    organizationId: input.organizationId,
    registrationId: input.registrationId,
  });
  validateRegistrationRequest(registration, input.providerHost, input.repositoryOwner);
  validateActiveRegistrationMaterial(registration);

  return buildGitProviderAccess(registration);
}

function validateRegistrationRequest(
  registration: GitProviderRegistrationRow,
  providerHost: string,
  repositoryOwner: string,
): void {
  if (
    registration.providerHost === providerHost &&
    registration.repositoryOwner.toLowerCase() === repositoryOwner.toLowerCase()
  ) {
    return;
  }

  throw createGitSourceRequestInvalidError('GitHub registration does not match the selected repository owner.');
}

function validateActiveRegistrationMaterial(registration: GitProviderRegistrationRow): void {
  if (registration.status === 'pending') {
    throw createGitSourceRegistrationPendingError();
  }
  if (registration.status !== 'active') {
    throw createGitSourceRegistrationFailedError('GitHub App registration is not active.');
  }

  const requiredFields: readonly (readonly [string, string | null])[] = [
    ['app_id', registration.appId],
    ['installation_id', registration.installationId],
    ['private_key_pem_ciphertext', registration.privateKeyPemCiphertext],
    ['private_key_pem_encryption_key_id', registration.privateKeyPemEncryptionKeyId],
  ];
  for (const field of requiredFields) {
    assertActiveRegistrationField(field[1], field[0]);
  }
}

function assertActiveRegistrationField(value: string | null, label: string): void {
  if (hasText(value)) {
    return;
  }

  throw createGitSourceRegistrationFailedError(`GitHub App registration is missing ${label} and must be reconnected.`);
}
