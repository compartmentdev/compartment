import type {
  GitProviderRegistrationRepositoryListResponse,
  GitProviderRepositorySummary,
} from '@compartment/contracts';
import { listGitHubInstallationRepositoriesForSource } from '../../services/sources.service';
import type { AuthenticatedContext } from '../../services/context.types';

export async function readGitHubInstallationRepositoriesForSelection(
  context: AuthenticatedContext,
  registrationId: string,
): Promise<GitProviderRepositorySummary[]> {
  const response: GitProviderRegistrationRepositoryListResponse = await listGitHubInstallationRepositoriesForSource(
    context,
    registrationId,
  );
  return response.repositories;
}
