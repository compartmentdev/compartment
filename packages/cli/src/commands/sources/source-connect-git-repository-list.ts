import type {
  GitHubInstallationRepositoryListResponse,
  GitHubInstallationRepositorySummary,
  GitHubProviderBootstrapResponse,
} from '@compartment/contracts';
import { listGitHubInstallationRepositoriesForSource } from '../../services/sources.service';
import type { AuthenticatedContext } from '../../services/context.types';
import type { CliCommandDependencies } from '../command.types';
import { waitForGitHubSourceBootstrap } from './source-connect-git-bootstrap.command';
import type { LocalGitSourcePlan } from '../../services/source-git-local.service.types';
import { promptVisibleText } from '../../prompts/prompt';

export function formatGitRepositoryListItem(repository: GitHubInstallationRepositorySummary): string {
  return `- ${repository.fullName}\tdefault branch: ${repository.defaultBranchName}`;
}

export function readDefaultGitRepositoryFullName(repositoryOwner: string, plan: LocalGitSourcePlan): string {
  return `${repositoryOwner}/${plan.repositoryName}`;
}

export async function resolveGitRepositoryOwner(
  dependencies: CliCommandDependencies,
  plan: LocalGitSourcePlan,
): Promise<string> {
  return await promptVisibleText(dependencies.io, 'GitHub account or organization', plan.repositoryOwner);
}

export async function readGitHubInstallationRepositoriesForSelection(
  dependencies: CliCommandDependencies,
  context: AuthenticatedContext,
  registrationId: string,
  providerHost: string,
  repositoryOwner: string,
): Promise<GitHubInstallationRepositorySummary[]> {
  const response: GitHubInstallationRepositoryListResponse = await listGitHubInstallationRepositoriesForSource(
    context,
    registrationId,
    providerHost,
    repositoryOwner,
  );
  return response.status === 'ready'
    ? response.repositories
    : await readGitHubInstallationRepositoriesAfterProviderRecovery(
        dependencies,
        context,
        providerHost,
        repositoryOwner,
      );
}

async function readGitHubInstallationRepositoriesAfterProviderRecovery(
  dependencies: CliCommandDependencies,
  context: AuthenticatedContext,
  providerHost: string,
  repositoryOwner: string,
): Promise<GitHubInstallationRepositorySummary[]> {
  const bootstrap: GitHubProviderBootstrapResponse = await waitForGitHubSourceBootstrap(dependencies, context, {
    providerHost,
    repositoryOwner,
  });
  const response: GitHubInstallationRepositoryListResponse = await listGitHubInstallationRepositoriesForSource(
    context,
    bootstrap.registrationId,
    providerHost,
    repositoryOwner,
  );
  if (response.status === 'ready') {
    return response.repositories;
  }
  throw new Error('GitHub App installation repositories could not be read after setup.');
}
