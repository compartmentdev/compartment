import type { SourceRow } from '../../queries/source.query.types';
import {
  createGitLabTokenInvalidError,
  createGitSourceRepositoryAccessDeniedError,
  createGitSourceRepositoryEmptyError,
} from '../../errors/api-business-error';
import type { ResolvedRepositoryAccess } from './git-source-connect.validation';
import type {
  GitProviderAccess,
  GitProviderAdapter,
  GitRepositoryMetadata,
  GitRepositoryRef,
  SourceProviderHookTarget,
} from './git-source-provider.types';
import type { ConnectGitSourceInput, GitSourceRepositoryRequest } from './git-source.service.types';
import {
  requireActiveGitProviderAccess,
  requireGitProviderAccessByRegistrationId,
} from './git-source-provider-access.service';
import { getGitProviderAdapter } from './git-source-provider.registry';

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
  const ref: GitRepositoryRef = buildConnectRepositoryRef(input.request);
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
    repositoryAccess: { providerInstallationId, providerWebhookId: null, registration: { id: access.registration.id } },
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
  return input.request.registrationId === undefined
    ? await requireActiveGitProviderAccess(
        input.organizationId,
        input.request.providerHost,
        input.request.repositoryOwner,
      )
    : await requireGitProviderAccessByRegistrationId(
        input.organizationId,
        input.request.registrationId,
        input.request.providerHost,
      );
}

async function resolveConnectRepositoryInstallationId(
  adapter: GitProviderAdapter,
  access: GitProviderAccess,
  ref: GitRepositoryRef,
): Promise<string | null> {
  try {
    return (await adapter.resolveRepositoryInstallation(access, ref)).providerInstallationId;
  } catch (error) {
    throw createGitSourceRepositoryAccessDeniedError(error instanceof Error ? error.message : undefined);
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

function buildConnectRepositoryRef(request: GitSourceRepositoryRequest): GitRepositoryRef {
  return { name: request.repositoryName, owner: request.repositoryOwner, providerHost: request.providerHost };
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
  if (adapter.isRepositoryEmptyFailure(error)) {
    throw createGitSourceRepositoryEmptyError();
  }
  if (adapter.isRepositoryAccessFailure(error)) {
    throw createGitSourceRepositoryAccessDeniedError(message);
  }
  if (adapter.providerType === 'gitlab' && adapter.isAuthenticationFailure(error)) {
    throw createGitLabTokenInvalidError();
  }
  throw error ?? new Error(message);
}

export async function cleanupProviderHook(
  adapter: GitProviderAdapter,
  access: GitProviderAccess,
  target: SourceProviderHookTarget,
): Promise<void> {
  try {
    await adapter.onSourceDisconnected(access, target);
  } catch {
    /* best-effort compensation */
  }
}

export async function disconnectSourceProviderHook(source: SourceRow): Promise<void> {
  try {
    const access: GitProviderAccess = await requireGitProviderAccessByRegistrationId(
      source.organizationId,
      source.providerRegistrationId,
      source.providerHost,
    );
    await getGitProviderAdapter(access.registration.providerType).onSourceDisconnected(access, {
      providerWebhookId: source.providerWebhookId,
      repositoryExternalId: source.repositoryExternalId,
    });
  } catch {
    /* best-effort cleanup */
  }
}
