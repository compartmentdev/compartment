import { requireGitProviderAccessByRegistrationId } from './git-source-provider-access.service';
import type { GitProviderAccess } from './git-source-provider.types';
import type { GitSourceContextInput } from './git-source.service.types';

interface GitProviderRegistrationAccessInput extends GitSourceContextInput {
  registrationId: string;
}

export async function requireGitProviderRegistrationAccess(
  input: GitProviderRegistrationAccessInput,
): Promise<GitProviderAccess> {
  return await requireGitProviderAccessByRegistrationId(input.organizationId, input.registrationId);
}
