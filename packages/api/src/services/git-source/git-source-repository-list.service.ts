import { requireGitProviderRegistrationAccess } from './git-source-descriptor-registration-access.service';
import { getGitProviderAdapter } from './git-source-provider.registry';
import { throwGitProviderBusinessError } from './git-source-provider-error.service';
import type {
  GitProviderAccess,
  GitProviderAdapter,
  GitProviderRepositoryListView,
  GitProviderRepositoryView,
  GitRepositorySummary,
} from './git-source-provider.types';
import type { GitSourceContextInput } from './git-source.service.types';

interface ListGitProviderRegistrationRepositoriesInput extends GitSourceContextInput {
  registrationId: string;
}

export async function listGitProviderRegistrationRepositories(
  input: ListGitProviderRegistrationRepositoriesInput,
): Promise<GitProviderRepositoryListView> {
  const access: GitProviderAccess = await requireGitProviderRegistrationAccess(input);
  const adapter: GitProviderAdapter = getGitProviderAdapter(access.registration.providerType);
  try {
    const repositories: GitRepositorySummary[] = await adapter.listRegistrationRepositories(access);
    return { repositories: repositories.map(toRepositorySummary) };
  } catch (error) {
    const providerError: Error | undefined = error instanceof Error ? error : undefined;
    throwGitProviderBusinessError(adapter, providerError, 'The registered repositories could not be read.');
  }
}

function toRepositorySummary(repository: GitRepositorySummary): GitProviderRepositoryView {
  return {
    defaultBranchName: repository.defaultBranchName,
    fullName: repository.fullName,
    id: repository.repositoryExternalId,
    name: repository.repositoryName,
    owner: repository.repositoryOwner,
    private: repository.private,
  };
}
