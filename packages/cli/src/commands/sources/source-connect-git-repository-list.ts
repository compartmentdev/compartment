import type {
  GitProviderRegistrationRepositoryListResponse,
  GitProviderRepositorySummary,
} from '@compartment/contracts';
import { listGitProviderRepositoriesForSource } from '../../services/sources.service';
import type { AuthenticatedContext } from '../../services/context.types';

export async function readGitProviderRepositoriesForSelection(
  context: AuthenticatedContext,
  registrationId: string,
): Promise<GitProviderRepositorySummary[]> {
  const response: GitProviderRegistrationRepositoryListResponse = await listGitProviderRepositoriesForSource(
    context,
    registrationId,
  );
  return response.repositories;
}
