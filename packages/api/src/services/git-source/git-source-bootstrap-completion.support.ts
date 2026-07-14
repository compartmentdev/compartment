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
  appName: string;
  appSlug: string;
  appUrl: string;
  organizationId: string;
  privateKeyPemCiphertext: string;
  privateKeyPemEncryptionKeyId: string;
  providerHost: string;
  registrationId: string;
  repositoryOwner: string;
  returnTo: string | null;
  stateId: string;
}

interface GitHubBootstrapCredentialState extends GitProviderBootstrapStateRow {
  appId: string;
  appName: string;
  appSlug: string;
  appUrl: string;
  privateKeyPemCiphertext: string;
  privateKeyPemEncryptionKeyId: string;
}

export function buildClaimedGitHubBootstrapSetup(
  state: GitProviderBootstrapStateRow,
  registration: GitProviderRegistrationRow,
): ClaimedGitHubBootstrapSetup {
  const credentialState: GitHubBootstrapCredentialState = requireGitHubBootstrapCredentialState(state);
  return {
    appId: credentialState.appId,
    appName: credentialState.appName,
    appSlug: credentialState.appSlug,
    appUrl: credentialState.appUrl,
    organizationId: registration.organizationId,
    privateKeyPemCiphertext: credentialState.privateKeyPemCiphertext,
    privateKeyPemEncryptionKeyId: credentialState.privateKeyPemEncryptionKeyId,
    providerHost: registration.providerHost,
    registrationId: registration.id,
    repositoryOwner: state.repositoryOwner,
    returnTo: state.returnTo,
    stateId: state.id,
  };
}

function requireGitHubBootstrapCredentialState(state: GitProviderBootstrapStateRow): GitHubBootstrapCredentialState {
  if (
    state.appId === null ||
    state.appName === null ||
    state.appSlug === null ||
    state.appUrl === null ||
    state.privateKeyPemCiphertext === null ||
    state.privateKeyPemEncryptionKeyId === null
  ) {
    throw createGitSourceBootstrapInvalidError();
  }
  return state as GitHubBootstrapCredentialState;
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
