import type {
  GitHubAccountDiscoveryAccount,
  GitHubAccountDiscoveryAppInstallationStatus,
  GitHubAccountDiscoveryResultRequest,
  GitHubAccountDiscoveryResultResponse,
  GitHubAccountDiscoveryStartRequest,
  GitHubAccountDiscoveryStartResponse,
} from '@compartment/contracts';
import { readUrlOrigin } from '@compartment/utils';
import { createGitSourceRegistrationFailedError } from '../../errors/api-business-error';
import { findActiveGitProviderRegistrationsByRepositoryOwners } from '../../queries/git-provider-registration-active-owners.query';
import type { GitProviderRegistrationRow } from '../../queries/git-provider-registration.query.types';
import { getApiConfig } from '../../runtime/runtime-access';
import { buildRuntimePublicSettings } from '../public-hosts.service';
import {
  type GitHubAccountDiscoveryBrokerAccount,
  type GitHubAccountDiscoveryBrokerResultResponse,
  readGitHubAccountDiscoveryBrokerResult,
  startGitHubAccountDiscoveryBrokerSession,
} from './github-account-discovery-broker.adapter';
import { readActiveGitHubRegistrationState } from './git-source-bootstrap-active-validation.service';

interface ReadGitHubAccountDiscoveryResultInput {
  organizationId: string;
  providerHost: string;
  request: GitHubAccountDiscoveryResultRequest;
}

export async function startGitHubAccountDiscovery(
  input: GitHubAccountDiscoveryStartRequest,
): Promise<GitHubAccountDiscoveryStartResponse> {
  assertRuntimeReturnTo(input.returnTo);
  return await startGitHubAccountDiscoveryBrokerSession(input);
}

export async function readGitHubAccountDiscoveryResult(
  input: Readonly<ReadGitHubAccountDiscoveryResultInput>,
): Promise<GitHubAccountDiscoveryResultResponse> {
  const brokerResult: GitHubAccountDiscoveryBrokerResultResponse = await readGitHubAccountDiscoveryBrokerResult(
    input.request,
  );
  const installedOwners: Set<string> = await readInstalledGitHubAccountOwners(
    input,
    brokerResult.accounts,
    brokerResult.user,
  );

  return {
    accounts: brokerResult.accounts.map(
      (account: GitHubAccountDiscoveryBrokerAccount): GitHubAccountDiscoveryAccount =>
        buildGitHubAccountDiscoveryAccount(account, installedOwners),
    ),
    user: buildGitHubAccountDiscoveryAccount(brokerResult.user, installedOwners),
  };
}

function assertRuntimeReturnTo(returnTo: string): void {
  const compartmentUrl: string = buildRuntimePublicSettings(getApiConfig()).compartmentUrl;
  if (readUrlOrigin(returnTo) === compartmentUrl) {
    return;
  }

  throw createGitSourceRegistrationFailedError('GitHub account discovery return URL does not belong to this install.');
}

async function readInstalledGitHubAccountOwners(
  input: Readonly<ReadGitHubAccountDiscoveryResultInput>,
  accounts: GitHubAccountDiscoveryBrokerAccount[],
  user: GitHubAccountDiscoveryBrokerAccount,
): Promise<Set<string>> {
  const registrations: GitProviderRegistrationRow[] = await findActiveGitProviderRegistrationsByRepositoryOwners({
    organizationId: input.organizationId,
    providerHost: input.providerHost,
    repositoryOwners: [
      ...accounts.map((account: GitHubAccountDiscoveryBrokerAccount): string => account.login),
      user.login,
    ],
  });

  return new Set(await readValidatedGitHubAccountOwners(registrations));
}

async function readValidatedGitHubAccountOwners(registrations: GitProviderRegistrationRow[]): Promise<string[]> {
  return (
    await Promise.all(
      registrations.map(
        async (registration: GitProviderRegistrationRow): Promise<string | null> =>
          (await readActiveGitHubRegistrationState(registration)) === 'valid'
            ? registration.repositoryOwner.toLowerCase()
            : null,
      ),
    )
  ).filter((repositoryOwner: string | null): repositoryOwner is string => repositoryOwner !== null);
}

function buildGitHubAccountDiscoveryAccount(
  account: GitHubAccountDiscoveryBrokerAccount,
  installedOwners: ReadonlySet<string>,
): GitHubAccountDiscoveryAccount {
  return {
    appInstallationStatus: readGitHubAccountDiscoveryAppInstallationStatus(account.login, installedOwners),
    avatarUrl: account.avatarUrl,
    login: account.login,
    type: account.type,
  };
}

function readGitHubAccountDiscoveryAppInstallationStatus(
  login: string,
  installedOwners: ReadonlySet<string>,
): GitHubAccountDiscoveryAppInstallationStatus {
  return installedOwners.has(login.toLowerCase()) ? 'installed' : 'not_installed';
}
