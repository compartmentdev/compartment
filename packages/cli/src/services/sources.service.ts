import type {
  ConnectGitSourceRequest,
  DisconnectGitSourceResponse,
  GitSourceExclusionMutationResponse,
  GitHubInstallationRepositoryListResponse,
  GitHubProviderBootstrapResponse,
  GitSourceListResponse,
  GitSourceResponse,
  GitSourceSettingsResponse,
  GitSourceSyncTaskResponse,
  UpdateGitSourceSettingsRequest,
} from '@compartment/contracts';
import {
  connectGitSource as connectGitSourceApi,
  disconnectGitSource as disconnectGitSourceApi,
  excludeGitSourceDescriptor as excludeGitSourceDescriptorApi,
  getGitHubProviderBootstrapStatus as getGitHubProviderBootstrapStatusApi,
  getGitSource as getGitSourceApi,
  getGitSourceSettings as getGitSourceSettingsApi,
  getGitSourceSyncTask as getGitSourceSyncTaskApi,
  includeGitSourceDescriptor as includeGitSourceDescriptorApi,
  listGitHubInstallationRepositories as listGitHubInstallationRepositoriesApi,
  listGitSources as listGitSourcesApi,
  startGitSourceSync as startGitSourceSyncApi,
  startGitHubProviderBootstrap as startGitHubProviderBootstrapApi,
  updateGitSourceSettings as updateGitSourceSettingsApi,
  type CompartmentRequester,
} from '@compartment/sdk';
import { createAuthenticatedRequester, requireOrganizationContext } from './context.service';
import type { AuthenticatedContext } from './context.types';

export async function listSources(context: AuthenticatedContext): Promise<GitSourceListResponse> {
  return await listGitSourcesApi(createSourceRequester(context));
}

export async function showSource(context: AuthenticatedContext, sourceId: string): Promise<GitSourceResponse> {
  return await getGitSourceApi(createSourceRequester(context), sourceId);
}

export async function disconnectSource(
  context: AuthenticatedContext,
  sourceId: string,
): Promise<DisconnectGitSourceResponse> {
  return await disconnectGitSourceApi(createSourceRequester(context), sourceId);
}

export async function startGitHubSourceBootstrap(
  context: AuthenticatedContext,
  providerHost: string,
  repositoryOwner: string,
): Promise<GitHubProviderBootstrapResponse> {
  return await startGitHubProviderBootstrapApi(createSourceRequester(context), {
    providerHost,
    repositoryOwner,
  });
}

export async function getGitHubSourceBootstrapStatus(
  context: AuthenticatedContext,
  bootstrapStateId: string,
): Promise<GitHubProviderBootstrapResponse> {
  return await getGitHubProviderBootstrapStatusApi(createSourceRequester(context), bootstrapStateId);
}

export async function listGitHubInstallationRepositoriesForSource(
  context: AuthenticatedContext,
  registrationId: string,
  providerHost: string,
  repositoryOwner: string,
): Promise<GitHubInstallationRepositoryListResponse> {
  return await listGitHubInstallationRepositoriesApi(createSourceRequester(context), registrationId, {
    providerHost,
    repositoryOwner,
  });
}

export async function connectGitSource(
  context: AuthenticatedContext,
  request: ConnectGitSourceRequest,
): Promise<GitSourceResponse> {
  return await connectGitSourceApi(createSourceRequester(context), request);
}

export async function readSourceSettings(
  context: AuthenticatedContext,
  sourceId: string,
): Promise<GitSourceSettingsResponse> {
  return await getGitSourceSettingsApi(createSourceRequester(context), sourceId);
}

export async function updateSourceSettingsForSource(
  context: AuthenticatedContext,
  sourceId: string,
  input: UpdateGitSourceSettingsRequest,
): Promise<GitSourceSettingsResponse> {
  return await updateGitSourceSettingsApi(createSourceRequester(context), sourceId, input);
}

export async function excludeSourceDescriptor(
  context: AuthenticatedContext,
  sourceId: string,
  descriptorPath: string,
): Promise<GitSourceExclusionMutationResponse> {
  return await excludeGitSourceDescriptorApi(createSourceRequester(context), sourceId, { descriptorPath });
}

export async function includeSourceDescriptor(
  context: AuthenticatedContext,
  sourceId: string,
  descriptorPath: string,
): Promise<GitSourceSyncTaskResponse> {
  return await includeGitSourceDescriptorApi(createSourceRequester(context), sourceId, { descriptorPath });
}

export async function startGitSourceSync(
  context: AuthenticatedContext,
  sourceId: string,
): Promise<GitSourceSyncTaskResponse> {
  return await startGitSourceSyncApi(createSourceRequester(context), sourceId);
}

export async function getGitSourceSyncTask(
  context: AuthenticatedContext,
  sourceId: string,
  taskId: string,
): Promise<GitSourceSyncTaskResponse> {
  return await getGitSourceSyncTaskApi(createSourceRequester(context), sourceId, taskId);
}

function createSourceRequester(context: AuthenticatedContext): CompartmentRequester {
  return createAuthenticatedRequester(requireOrganizationContext(context), {
    includeCurrentOrganization: true,
  });
}
