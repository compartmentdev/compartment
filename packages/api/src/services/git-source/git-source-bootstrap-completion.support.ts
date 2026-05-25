import { createGitSourceBootstrapInvalidError } from '../../errors/api-business-error';
import { decryptVariableValueFromStorage } from '../../lib/variables-crypto';
import { getApiConfig } from '../../runtime/runtime-access';
import { readGitHubAppInstallation } from './github-app-client.adapter';
import type { GitHubAppInstallation } from './github-app-client.adapter.types';
import type {
  GitProviderBootstrapStateRow,
  GitProviderRegistrationRow,
} from '../../queries/git-provider-registration.query.types';

export interface ClaimedGitHubBootstrapSetup {
  appId: string;
  organizationId: string;
  privateKeyPemCiphertext: string;
  privateKeyPemEncryptionKeyId: string;
  providerHost: string;
  registrationId: string;
  repositoryOwner: string;
  returnTo: string | null;
  stateId: string;
}

export function buildClaimedGitHubBootstrapSetup(
  state: GitProviderBootstrapStateRow,
  registration: GitProviderRegistrationRow,
): ClaimedGitHubBootstrapSetup {
  if (
    registration.appId === null ||
    registration.privateKeyPemCiphertext === null ||
    registration.privateKeyPemEncryptionKeyId === null
  ) {
    throw createGitSourceBootstrapInvalidError();
  }
  return {
    appId: registration.appId,
    organizationId: registration.organizationId,
    privateKeyPemCiphertext: registration.privateKeyPemCiphertext,
    privateKeyPemEncryptionKeyId: registration.privateKeyPemEncryptionKeyId,
    providerHost: registration.providerHost,
    registrationId: registration.id,
    repositoryOwner: state.repositoryOwner,
    returnTo: state.returnTo,
    stateId: state.id,
  };
}

export function readClaimedGitHubBootstrapSetupPrivateKey(claimedSetup: ClaimedGitHubBootstrapSetup): string {
  return decryptVariableValueFromStorage(
    claimedSetup.privateKeyPemCiphertext,
    claimedSetup.privateKeyPemEncryptionKeyId,
    getApiConfig().variablesMasterKey,
  );
}

export async function verifyGitHubProviderBootstrapInstallation(
  claimedSetup: ClaimedGitHubBootstrapSetup,
  installationId: string,
  privateKeyPem: string,
): Promise<GitHubAppInstallation> {
  return await verifyGitHubProviderBootstrapAccountInstallation(claimedSetup, installationId, privateKeyPem);
}

async function verifyGitHubProviderBootstrapAccountInstallation(
  claimedSetup: ClaimedGitHubBootstrapSetup,
  installationId: string,
  privateKeyPem: string,
): Promise<GitHubAppInstallation> {
  const installation: GitHubAppInstallation = await readGitHubAppInstallation({
    appId: claimedSetup.appId,
    installationId,
    privateKeyPem,
    providerHost: claimedSetup.providerHost,
  });
  if (installation.installationId !== installationId) {
    throw createGitSourceBootstrapInvalidError('GitHub App installation id mismatch.');
  }
  if (installation.accountLogin.toLowerCase() !== claimedSetup.repositoryOwner.toLowerCase()) {
    throw createGitSourceBootstrapInvalidError('GitHub App installation account does not match the requested owner.');
  }

  return installation;
}
