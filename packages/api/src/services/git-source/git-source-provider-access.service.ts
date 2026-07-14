import {
  createGitSourceRegistrationFailedError,
  createGitSourceRegistrationPendingError,
} from '../../errors/api-business-error';
import { findGitProviderRegistrationById } from '../../queries/git-provider-registration.query';
import type { GitProviderRegistrationRow } from '../../queries/git-provider-registration.query.types';
import { getGitProviderAdapter } from './git-source-provider.registry';
import type { GitProviderAccess } from './git-source-provider.types';

export async function requireGitProviderAccessByRegistrationId(
  organizationId: string,
  registrationId: string,
): Promise<GitProviderAccess> {
  const registration: GitProviderRegistrationRow | undefined = await findGitProviderRegistrationById({
    organizationId,
    registrationId,
  });
  if (registration?.status === 'pending') {
    throw createGitSourceRegistrationPendingError();
  }
  if (registration?.status !== 'active') {
    throw createGitSourceRegistrationFailedError('The selected git provider registration is not active.');
  }
  return buildGitProviderAccess(registration);
}

export function buildGitProviderAccess(registration: GitProviderRegistrationRow): GitProviderAccess {
  try {
    return {
      credential: getGitProviderAdapter(registration.providerType).readRegistrationCredential(registration),
      registration,
    };
  } catch {
    throw createGitSourceRegistrationFailedError('The selected git provider registration has invalid credentials.');
  }
}
