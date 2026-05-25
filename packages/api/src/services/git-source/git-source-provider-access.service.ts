import { decryptVariableValueFromStorage } from '../../lib/variables-crypto';
import {
  createGitSourceRegistrationFailedError,
  createGitSourceRegistrationPendingError,
} from '../../errors/api-business-error';
import { findActiveGitProviderRegistration } from '../../queries/git-provider-registration.query';
import { findPendingGitProviderRegistration } from '../../queries/git-provider-registration-bootstrap.query';
import type { GitProviderRegistrationRow } from '../../queries/git-provider-registration.query.types';
import { getApiConfig } from '../../runtime/runtime-access';
import { requireGitProviderField } from './git-source-view.service';

export interface GitHubProviderAccess {
  privateKeyPem: string;
  registration: GitProviderRegistrationRow;
}

export async function requireActiveGitHubProviderAccess(
  organizationId: string,
  providerHost: string,
  repositoryOwner: string,
): Promise<GitHubProviderAccess> {
  const registration: GitProviderRegistrationRow = await requireActiveGitProviderRegistration(
    organizationId,
    providerHost,
    repositoryOwner,
  );
  return {
    privateKeyPem: readGitHubRegistrationPrivateKey(registration),
    registration,
  };
}

export function readGitHubRegistrationPrivateKey(registration: GitProviderRegistrationRow): string {
  return decryptVariableValueFromStorage(
    requireGitProviderField(registration.privateKeyPemCiphertext, 'private_key_pem_ciphertext'),
    requireGitProviderField(registration.privateKeyPemEncryptionKeyId, 'private_key_pem_encryption_key_id'),
    getApiConfig().variablesMasterKey,
  );
}

async function requireActiveGitProviderRegistration(
  organizationId: string,
  providerHost: string,
  repositoryOwner: string,
): Promise<GitProviderRegistrationRow> {
  const activeRegistration: GitProviderRegistrationRow | undefined = await findActiveGitProviderRegistration({
    organizationId,
    providerHost,
    repositoryOwner,
  });
  if (activeRegistration !== undefined) {
    return activeRegistration;
  }

  if (
    (await findPendingGitProviderRegistration(organizationId, providerHost, repositoryOwner, new Date())) !== undefined
  ) {
    throw createGitSourceRegistrationPendingError();
  }

  throw createGitSourceRegistrationFailedError('Connect the install-owned GitHub App before registering this source.');
}
