import { listActiveGitProviderRegistrationsWithExecutor } from '../../queries/git-provider-registration.query';
import type {
  GitProviderRegistrationRow,
  GitProviderWriteExecutor,
} from '../../queries/git-provider-registration.query.types';
import { getApiDatabase } from '../../runtime/runtime-access';
import { buildGitProviderAccess } from './git-source-provider-access.service';
import { getGitProviderAdapter } from './git-source-provider.registry';
import type {
  GitProviderAdapter,
  GitProviderAccess,
  GitProviderRegistrationMetadata,
  GitProviderRegistrationView,
} from './git-source-provider.types';

export async function listGitProviderRegistrations(organizationId: string): Promise<GitProviderRegistrationView[]> {
  return await getApiDatabase().transaction(
    async (transaction: GitProviderWriteExecutor): Promise<GitProviderRegistrationView[]> => {
      const registrations: GitProviderRegistrationRow[] = await listActiveGitProviderRegistrationsWithExecutor(
        transaction,
        organizationId,
      );
      const views: GitProviderRegistrationView[] = [];
      for (const registration of registrations) {
        views.push(toRegistrationSummary(await buildGitProviderAccess(transaction, registration)));
      }
      return views;
    },
  );
}

function toRegistrationSummary(access: GitProviderAccess): GitProviderRegistrationView {
  const adapter: GitProviderAdapter = getGitProviderAdapter(access.registration.providerType);
  const metadata: GitProviderRegistrationMetadata = adapter.readRegistrationMetadata(access);
  return {
    createdAt: access.registration.createdAt.toISOString(),
    expiresAt: metadata.expiresAt?.toISOString() ?? null,
    providerAccountLogin: metadata.accountLogin,
    providerHost: access.registration.providerHost,
    providerType: adapter.providerType,
    registrationId: access.registration.id,
  };
}
