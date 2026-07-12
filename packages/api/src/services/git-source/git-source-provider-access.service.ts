import {
  createGitSourceRegistrationFailedError,
  createGitSourceRegistrationPendingError,
} from '../../errors/api-business-error';
import {
  findActiveGitProviderRegistration,
  findGitProviderRegistrationById,
} from '../../queries/git-provider-registration.query';
import { findPendingGitProviderRegistration } from '../../queries/git-provider-registration-bootstrap.query';
import type { GitProviderRegistrationRow } from '../../queries/git-provider-registration.query.types';
import { getGitProviderAdapter } from './git-source-provider.registry';
import type { GitProviderAccess } from './git-source-provider.types';

export async function requireActiveGitHubProviderAccess(
  organizationId: string,
  providerHost: string,
  repositoryOwner: string,
): Promise<GitProviderAccess> {
  return buildGitProviderAccess(
    await requireActiveGitHubProviderRegistration(organizationId, providerHost, repositoryOwner),
  );
}

export async function requireGitProviderAccessByRegistrationId(
  organizationId: string,
  registrationId: string,
  providerHost: string,
): Promise<GitProviderAccess> {
  const registration: GitProviderRegistrationRow | undefined = await findGitProviderRegistrationById({
    organizationId,
    registrationId,
  });
  if (registration?.status === 'pending' && registration.providerHost === providerHost) {
    throw createGitSourceRegistrationPendingError();
  }
  if (registration?.status !== 'active' || registration.providerHost !== providerHost) {
    throw createGitSourceRegistrationFailedError('The selected git provider registration is not active.');
  }
  return buildGitProviderAccess(registration);
}

export function buildGitProviderAccess(registration: GitProviderRegistrationRow): GitProviderAccess {
  return {
    credential: getGitProviderAdapter(registration.providerType).readRegistrationCredential(registration),
    registration,
  };
}

async function requireActiveGitHubProviderRegistration(
  organizationId: string,
  providerHost: string,
  repositoryOwner: string,
): Promise<GitProviderRegistrationRow> {
  const activeRegistration: GitProviderRegistrationRow | undefined = await findActiveGitProviderRegistration({
    organizationId,
    providerHost,
    repositoryOwner,
    providerType: 'github_app',
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
