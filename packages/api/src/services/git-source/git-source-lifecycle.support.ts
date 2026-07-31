import type { SourceRow } from '../../queries/source.query.types';
import type { ResolvedRepositoryAccess } from './git-source-connect.validation';
import type {
  GitProviderAccess,
  GitProviderAdapter,
  GitRepositoryMetadata,
  GitRepositoryRef,
  SourceProviderHookTarget,
} from './git-source-provider.types';
import type { ConnectGitSourceInput, GitSourceRepositoryRequest } from './git-source.service.types';
import { requireGitProviderAccessByRegistrationId } from './git-source-provider-access.service';
import { getGitProviderAdapter } from './git-source-provider.registry';
import { throwGitProviderBusinessError } from './git-source-provider-error.service';

export interface ResolvedConnectRepository {
  adapter: GitProviderAdapter;
  hookTarget: SourceProviderHookTarget;
  providerAccess: GitProviderAccess;
  repository: GitRepositoryMetadata;
  repositoryAccess: ResolvedRepositoryAccess;
}

export async function resolveConnectRepository(input: ConnectGitSourceInput): Promise<ResolvedConnectRepository> {
  const access: GitProviderAccess = await resolveConnectProviderAccess(input);
  const adapter: GitProviderAdapter = getGitProviderAdapter(access.registration.providerType);
  const ref: GitRepositoryRef = buildConnectRepositoryRef(input.request, access.registration.providerHost);
  const providerInstallationId: string | null = await resolveConnectRepositoryInstallationId(adapter, access, ref);
  const repository: GitRepositoryMetadata = await readConnectRepository(
    adapter,
    access,
    ref,
    providerInstallationId,
    input.request.syncBranchName,
  );
  return {
    adapter,
    hookTarget: { providerWebhookId: null, repositoryExternalId: repository.repositoryExternalId },
    providerAccess: access,
    repository,
    repositoryAccess: {
      providerInstallationId,
      providerWebhookId: null,
      registration: { id: access.registration.id, providerHost: access.registration.providerHost },
    },
  };
}

export async function connectResolvedProviderHook(
  resolved: ResolvedConnectRepository,
): Promise<ResolvedConnectRepository> {
  const providerWebhookId: string | null = await connectProviderHook(
    resolved.adapter,
    resolved.providerAccess,
    resolved.hookTarget,
  );
  return {
    ...resolved,
    hookTarget: { ...resolved.hookTarget, providerWebhookId },
    repositoryAccess: { ...resolved.repositoryAccess, providerWebhookId },
  };
}

async function readConnectRepository(
  adapter: GitProviderAdapter,
  access: GitProviderAccess,
  ref: GitRepositoryRef,
  providerInstallationId: string | null,
  syncBranchName: string,
): Promise<GitRepositoryMetadata> {
  let repository: GitRepositoryMetadata;
  try {
    repository = await adapter.readRepositoryMetadata(access, ref, providerInstallationId);
  } catch (error) {
    throwConnectRepositoryFailure(
      adapter,
      error instanceof Error ? error : undefined,
      'The selected repository could not be read.',
    );
  }
  await assertSelectedRepositoryBranchExists(adapter, access, ref, providerInstallationId, syncBranchName);
  return repository;
}

async function resolveConnectProviderAccess(input: ConnectGitSourceInput): Promise<GitProviderAccess> {
  return await requireGitProviderAccessByRegistrationId(input.organizationId, input.request.registrationId);
}

async function resolveConnectRepositoryInstallationId(
  adapter: GitProviderAdapter,
  access: GitProviderAccess,
  ref: GitRepositoryRef,
): Promise<string | null> {
  try {
    return (await adapter.resolveRepositoryInstallation(access, ref)).providerInstallationId;
  } catch (error) {
    throwConnectRepositoryFailure(
      adapter,
      error instanceof Error ? error : undefined,
      'The selected repository installation could not be resolved.',
    );
  }
}

async function assertSelectedRepositoryBranchExists(
  adapter: GitProviderAdapter,
  access: GitProviderAccess,
  ref: GitRepositoryRef,
  providerInstallationId: string | null,
  syncBranchName: string,
): Promise<void> {
  try {
    await adapter.assertRepositoryBranchExists(access, ref, providerInstallationId, syncBranchName);
  } catch (error) {
    throwConnectRepositoryFailure(
      adapter,
      error instanceof Error ? error : undefined,
      'The selected repository branch could not be read.',
    );
  }
}

function buildConnectRepositoryRef(request: GitSourceRepositoryRequest, providerHost: string): GitRepositoryRef {
  return { name: request.repositoryName, owner: request.repositoryOwner, providerHost };
}

async function connectProviderHook(
  adapter: GitProviderAdapter,
  access: GitProviderAccess,
  target: SourceProviderHookTarget,
): Promise<string | null> {
  try {
    return (await adapter.onSourceConnected(access, target)).providerWebhookId;
  } catch (error) {
    throwConnectRepositoryFailure(
      adapter,
      error instanceof Error ? error : undefined,
      'The repository webhook could not be created.',
    );
  }
}

function throwConnectRepositoryFailure(adapter: GitProviderAdapter, error: Error | undefined, message: string): never {
  throwGitProviderBusinessError(adapter, error, message);
}

export async function disconnectSourceProviderHook(source: SourceRow): Promise<void> {
  const access: GitProviderAccess = await requireGitProviderAccessByRegistrationId(
    source.organizationId,
    source.providerRegistrationId,
  );
  await getGitProviderAdapter(access.registration.providerType).onSourceDisconnected(access, {
    providerWebhookId: source.providerWebhookId,
    repositoryExternalId: source.repositoryExternalId,
  });
}
