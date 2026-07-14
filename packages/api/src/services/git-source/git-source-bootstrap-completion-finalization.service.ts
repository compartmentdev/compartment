import type {
  GitProviderRegistrationRow,
  GitProviderMutationTransaction,
  GitProviderWriteExecutor,
} from '../../queries/git-provider-registration.query.types';
import { getApiDatabase } from '../../runtime/runtime-access';
import type { GitHubAppInstallation } from './github-app-client.adapter.types';
import {
  readClaimedGitHubBootstrapSetupPrivateKey,
  type ClaimedGitHubBootstrapSetup,
  verifyGitHubProviderBootstrapInstallation,
} from './git-source-bootstrap-completion.support';
import {
  activatePersistedGitHubProviderRegistration,
  failPendingGitHubProviderRegistration,
} from './git-source-bootstrap.persistence';
import { markGitProviderBootstrapStateCompleted } from '../../queries/git-provider-bootstrap-state.query';

export async function verifyGitHubProviderBootstrapSetup(
  claimedSetup: ClaimedGitHubBootstrapSetup,
  installationId: string,
  now: Date,
): Promise<GitHubAppInstallation> {
  try {
    const privateKeyPem: string = readClaimedGitHubBootstrapSetupPrivateKey(claimedSetup);
    return await verifyGitHubProviderBootstrapInstallation(claimedSetup, installationId, privateKeyPem);
  } catch (error) {
    await failGitHubProviderBootstrap(toClaimedGitProviderRegistration(claimedSetup), claimedSetup.stateId, now);
    throw error;
  }
}

export async function finalizeGitHubProviderBootstrapSetup(
  claimedSetup: ClaimedGitHubBootstrapSetup,
  installation: GitHubAppInstallation,
  now: Date,
): Promise<void> {
  try {
    await activateGitHubProviderRegistrationWithFailureCleanup(claimedSetup, claimedSetup.stateId, installation, now);
  } catch (error) {
    await failGitHubProviderBootstrap(toClaimedGitProviderRegistration(claimedSetup), claimedSetup.stateId, now);
    throw error;
  }
}

export async function failGitHubProviderBootstrap(
  registration: Pick<GitProviderRegistrationRow, 'id' | 'organizationId'>,
  stateId: string | null,
  now: Date,
): Promise<void> {
  await getApiDatabase().transaction(async (transaction: GitProviderWriteExecutor): Promise<void> => {
    await failPendingGitHubProviderRegistration(transaction, registration, now);
    if (stateId !== null) {
      await markGitProviderBootstrapStateCompleted(transaction, registration.organizationId, stateId, now);
    }
  });
}

export function buildGitHubProviderSetupReturnTo(
  claimedSetup: ClaimedGitHubBootstrapSetup,
  installation: GitHubAppInstallation,
): string | null {
  if (claimedSetup.returnTo === null) {
    return null;
  }
  const url: URL = new URL(claimedSetup.returnTo, 'https://compartment.local');
  url.searchParams.set('github', 'ready');
  url.searchParams.set('registration', claimedSetup.registrationId);
  url.searchParams.set('installation', installation.installationId);
  return `${url.pathname}${url.search}`;
}

async function activateGitHubProviderRegistrationWithFailureCleanup(
  claimedSetup: ClaimedGitHubBootstrapSetup,
  stateId: string,
  installation: GitHubAppInstallation,
  now: Date,
): Promise<void> {
  await getApiDatabase().transaction(async (transaction: GitProviderMutationTransaction): Promise<void> => {
    await activatePersistedGitHubProviderRegistration(transaction, claimedSetup, installation, now);
    await markGitProviderBootstrapStateCompleted(transaction, claimedSetup.organizationId, stateId, now);
  });
}

function toClaimedGitProviderRegistration(
  claimedSetup: ClaimedGitHubBootstrapSetup,
): Pick<GitProviderRegistrationRow, 'id' | 'organizationId'> {
  return {
    id: claimedSetup.registrationId,
    organizationId: claimedSetup.organizationId,
  };
}
