import { listActiveGitProviderRegistrations } from '../../queries/git-provider-registration.query';
import type { GitProviderRegistrationRow } from '../../queries/git-provider-registration.query.types';
import { getGitProviderAdapter } from './git-source-provider.registry';
import type {
  GitProviderAdapter,
  GitProviderRegistrationMetadata,
  GitProviderRegistrationView,
} from './git-source-provider.types';

export async function listGitProviderRegistrations(organizationId: string): Promise<GitProviderRegistrationView[]> {
  return (await listActiveGitProviderRegistrations(organizationId)).map(toRegistrationSummary);
}

function toRegistrationSummary(registration: GitProviderRegistrationRow): GitProviderRegistrationView {
  const adapter: GitProviderAdapter = getGitProviderAdapter(registration.providerType);
  const metadata: GitProviderRegistrationMetadata = adapter.readRegistrationMetadata(registration);
  return {
    createdAt: registration.createdAt.toISOString(),
    expiresAt: metadata.expiresAt?.toISOString() ?? null,
    providerAccountLogin: metadata.accountLogin,
    providerHost: registration.providerHost,
    providerType: adapter.providerType,
    registrationId: registration.id,
  };
}
