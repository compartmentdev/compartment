import type { SourceRow } from '../../queries/source.query.types';
import { createGitSourceRepositoryAccessDeniedError } from '../../errors/api-business-error';
import type { ResolvedRepositoryAccess } from './git-source-connect.validation';
import type {
  GitProviderAccess,
  GitProviderAdapter,
  GitRepositoryMetadata,
  GitRepositoryRef,
} from './git-source-provider.types';
import type { ConnectGitSourceInput, GitSourceRepositoryRequest } from './git-source.service.types';
import {
  requireActiveGitProviderAccess,
  requireGitProviderAccessByRegistrationId,
} from './git-source-provider-access.service';
import { getGitProviderAdapter } from './git-source-provider.registry';

interface LifecycleSourceBase {
  automationPrincipalId: null;
  autoAdoptNewApps: boolean;
  createdAt: Date;
  createdByPrincipalId: string;
  defaultAutoDeployEnabled: boolean;
  defaultEnvironmentName: string;
  disconnectedAt: null;
  id: string;
  lastSyncAt: null;
  organizationId: string;
  providerHost: string;
  providerWebhookId: null;
  status: 'active';
  syncBranchName: string;
  type: 'git';
  updatedAt: Date;
}

export interface ResolvedConnectRepository {
  adapter: GitProviderAdapter;
  lifecycleSource: SourceRow;
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
  const lifecycleSource: SourceRow = buildConnectLifecycleSource(input, access, repository, providerInstallationId);
  return {
    adapter,
    lifecycleSource,
    providerAccess: access,
    repository,
    repositoryAccess: { providerInstallationId, providerWebhookId: null, registration: { id: access.registration.id } },
  };
}

export async function connectResolvedProviderHook(
  resolved: ResolvedConnectRepository,
  activeSource: SourceRow | undefined,
): Promise<ResolvedConnectRepository> {
  const lifecycleSource: SourceRow = activeSource ?? resolved.lifecycleSource;
  const providerWebhookId: string | null = await connectProviderHook(
    resolved.adapter,
    resolved.providerAccess,
    lifecycleSource,
  );
  return {
    ...resolved,
    lifecycleSource: { ...lifecycleSource, providerWebhookId },
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
  const repository: GitRepositoryMetadata = await adapter.readRepositoryMetadata(access, ref, providerInstallationId);
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
    if (adapter.isRepositoryAccessFailure(error instanceof Error ? error : undefined))
      throw createGitSourceRepositoryAccessDeniedError('The selected repository branch could not be read.');
    throw error;
  }
}

function buildConnectRepositoryRef(request: GitSourceRepositoryRequest): GitRepositoryRef {
  return { name: request.repositoryName, owner: request.repositoryOwner, providerHost: request.providerHost };
}

async function connectProviderHook(
  adapter: GitProviderAdapter,
  access: GitProviderAccess,
  source: SourceRow,
): Promise<string | null> {
  return (await adapter.onSourceConnected(access, source)).providerWebhookId;
}

export async function cleanupProviderHook(
  adapter: GitProviderAdapter,
  access: GitProviderAccess,
  source: SourceRow,
): Promise<void> {
  try {
    await adapter.onSourceDisconnected(access, source);
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
    await getGitProviderAdapter(access.registration.providerType).onSourceDisconnected(access, source);
  } catch {
    /* best-effort cleanup */
  }
}

function buildConnectLifecycleSource(
  input: ConnectGitSourceInput,
  access: GitProviderAccess,
  repository: GitRepositoryMetadata,
  providerInstallationId: string | null,
): SourceRow {
  const now: Date = new Date();
  return {
    ...buildLifecycleSourceBase(input, now),
    defaultBranchName: repository.defaultBranchName,
    displayName: `${repository.repositoryOwner}/${repository.repositoryName}`,
    providerInstallationId,
    providerRegistrationId: access.registration.id,
    repositoryCloneUrl: repository.repositoryCloneUrl,
    repositoryExternalId: repository.repositoryExternalId,
    repositoryName: repository.repositoryName,
    repositoryOwner: repository.repositoryOwner,
  };
}

function buildLifecycleSourceBase(input: ConnectGitSourceInput, now: Date): LifecycleSourceBase {
  return {
    automationPrincipalId: null,
    autoAdoptNewApps: input.request.autoAdoptNewApps,
    createdAt: now,
    createdByPrincipalId: input.actor.principalId,
    defaultAutoDeployEnabled: input.request.defaultAutoDeployEnabled,
    defaultEnvironmentName: input.request.defaultEnvironmentName,
    disconnectedAt: null,
    id: '',
    lastSyncAt: null,
    organizationId: input.organizationId,
    providerHost: input.request.providerHost,
    providerWebhookId: null,
    status: 'active',
    syncBranchName: input.request.syncBranchName,
    type: 'git',
    updatedAt: now,
  };
}
