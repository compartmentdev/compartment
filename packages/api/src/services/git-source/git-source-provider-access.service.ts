import {
  createGitSourceRegistrationFailedError,
  createGitSourceRegistrationPendingError,
} from '../../errors/api-business-error';
import { findGitProviderRegistrationByIdWithExecutor } from '../../queries/git-provider-registration.query';
import type {
  GitProviderReadExecutor,
  GitProviderRegistrationRow,
  GitProviderWriteExecutor,
} from '../../queries/git-provider-registration.query.types';
import { getApiDatabase } from '../../runtime/runtime-access';
import { getGitProviderAdapter } from './git-source-provider.registry';
import type { GitProviderAccess } from './git-source-provider.types';

export async function requireGitProviderAccessByRegistrationId(
  organizationId: string,
  registrationId: string,
): Promise<GitProviderAccess> {
  return await getApiDatabase().transaction(
    async (transaction: GitProviderWriteExecutor): Promise<GitProviderAccess> => {
      const registration: GitProviderRegistrationRow | undefined = await findGitProviderRegistrationByIdWithExecutor(
        transaction,
        { organizationId, registrationId },
      );
      if (registration?.status === 'pending') {
        throw createGitSourceRegistrationPendingError();
      }
      if (registration?.status !== 'active') {
        throw createGitSourceRegistrationFailedError('The selected git provider registration is not active.');
      }
      return await buildGitProviderAccess(transaction, registration);
    },
  );
}

export async function buildGitProviderAccess(
  executor: GitProviderReadExecutor,
  registration: GitProviderRegistrationRow,
): Promise<GitProviderAccess> {
  try {
    return {
      credential: await getGitProviderAdapter(registration.providerType).readRegistrationCredential(
        executor,
        registration.id,
      ),
      registration,
    };
  } catch {
    throw createGitSourceRegistrationFailedError('The selected git provider registration has invalid credentials.');
  }
}
