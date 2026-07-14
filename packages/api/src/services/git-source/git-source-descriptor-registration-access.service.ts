import {
  createGitSourceRegistrationFailedError,
  createGitSourceRegistrationPendingError,
} from '../../errors/api-business-error';
import type { GitProviderRegistrationRow } from '../../queries/git-provider-registration.query.types';
import { requireGitProviderRegistration } from './git-source-bootstrap.read';
import { buildGitProviderAccess } from './git-source-provider-access.service';
import type { GitProviderAccess } from './git-source-provider.types';
import type { GitSourceContextInput } from './git-source.service.types';

interface GitProviderRegistrationAccessInput extends GitSourceContextInput {
  registrationId: string;
}

export async function requireGitProviderRegistrationAccess(
  input: GitProviderRegistrationAccessInput,
): Promise<GitProviderAccess> {
  const registration: GitProviderRegistrationRow = await requireGitProviderRegistration({
    organizationId: input.organizationId,
    registrationId: input.registrationId,
  });
  validateActiveRegistration(registration);

  return buildGitProviderAccess(registration);
}

function validateActiveRegistration(registration: GitProviderRegistrationRow): void {
  if (registration.status === 'pending') {
    throw createGitSourceRegistrationPendingError();
  }
  if (registration.status !== 'active') {
    throw createGitSourceRegistrationFailedError('Git provider registration is not active.');
  }
}
