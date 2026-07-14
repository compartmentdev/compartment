import type {
  ConnectGitSourceRequest,
  DisconnectGitSourceResponse,
  GitSourceExclusionMutationResponse,
  GitProviderRegistrationRepositoryListResponse,
  GitHubProviderBootstrapResponse,
  GitSourceListResponse,
  GitSourceResponse,
  GitSourceSettingsResponse,
  GitSourceSyncTaskResponse,
  CreateGitProviderRegistrationResponse,
  GitProviderRegistrationListResponse,
  UpdateGitSourceSettingsRequest,
} from '@compartment/contracts';
import {
  connectGitSource as connectGitSourceApi,
  createGitLabProviderRegistration as createGitLabProviderRegistrationApi,
  disconnectGitSource as disconnectGitSourceApi,
  excludeGitSourceDescriptor as excludeGitSourceDescriptorApi,
  getGitHubProviderBootstrapStatus as getGitHubProviderBootstrapStatusApi,
  getGitSource as getGitSourceApi,
  getGitSourceSettings as getGitSourceSettingsApi,
  getGitSourceSyncTask as getGitSourceSyncTaskApi,
  includeGitSourceDescriptor as includeGitSourceDescriptorApi,
  listGitProviderRegistrationRepositories as listGitProviderRegistrationRepositoriesApi,
  listGitProviderRegistrations as listGitProviderRegistrationsApi,
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

export async function createGitLabSourceRegistration(
  context: AuthenticatedContext,
  providerHost: string,
  accessToken: string,
): Promise<CreateGitProviderRegistrationResponse> {
  return await createGitLabProviderRegistrationApi(createSourceRequester(context), { accessToken, providerHost });
}

export async function listGitSourceRegistrations(
  context: AuthenticatedContext,
): Promise<GitProviderRegistrationListResponse> {
  return await listGitProviderRegistrationsApi(createSourceRequester(context));
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

export async function listGitProviderRepositoriesForSource(
  context: AuthenticatedContext,
  registrationId: string,
): Promise<GitProviderRegistrationRepositoryListResponse> {
  return await listGitProviderRegistrationRepositoriesApi(createSourceRequester(context), registrationId);
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
