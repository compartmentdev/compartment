import {
  createGitSourceRegistrationFailedError,
  createGitSourceRegistrationPendingError,
} from '../../errors/api-business-error';
import { findActiveGitProviderRegistration } from '../../queries/git-provider-registration.query';
import { findPendingGitProviderRegistration } from '../../queries/git-provider-registration-bootstrap.query';
import type { GitProviderRegistrationRow } from '../../queries/git-provider-registration.query.types';
import { getGitProviderAdapter } from './git-source-provider.registry';
import type { GitProviderAccess } from './git-source-provider.types';

export async function requireActiveGitProviderAccess(
  organizationId: string,
  providerHost: string,
  repositoryOwner: string,
): Promise<GitProviderAccess> {
  return buildGitProviderAccess(
    await requireActiveGitProviderRegistration(organizationId, providerHost, repositoryOwner),
  );
}

export function buildGitProviderAccess(registration: GitProviderRegistrationRow): GitProviderAccess {
  return {
    credential: getGitProviderAdapter(registration.providerType).readRegistrationCredential(registration),
    registration,
  };
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
