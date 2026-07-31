import {
  buildCompartmentGitProviderRegistrationRepositoriesPathname,
  buildCompartmentGitSourceExcludePathname,
  buildCompartmentGitSourceIncludePathname,
  buildCompartmentGitSourceSettingsPathname,
  compartmentGitHubProviderBootstrapPathname,
  compartmentGitProviderRegistrationsPathname,
  compartmentGitLabProviderRegistrationsPathname,
  compartmentGitSourceConnectPathname,
  compartmentSourcesPathname,
  disconnectGitSourceResponseSchema,
  gitSourceExclusionMutationResponseSchema,
  gitProviderRegistrationRepositoryListResponseSchema,
  gitHubProviderBootstrapResponseSchema,
  createGitProviderRegistrationResponseSchema,
  gitProviderRegistrationListResponseSchema,
  gitSourceListResponseSchema,
  gitSourceResponseSchema,
  gitSourceSettingsResponseSchema,
  gitSourceSyncTaskResponseSchema,
  type ConnectGitSourceRequest,
  type CreateGitLabProviderRegistrationRequest,
  type CreateGitProviderRegistrationResponse,
  type DisconnectGitSourceResponse,
  type GitSourceExclusionMutationResponse,
  type GitHubProviderBootstrapRequest,
  type GitHubProviderBootstrapResponse,
  type GitProviderRegistrationListResponse,
  type GitProviderRegistrationRepositoryListResponse,
  type GitSourceListResponse,
  type GitSourceResponse,
  type GitSourceSettingsResponse,
  type GitSourceSyncTaskResponse,
  type UpdateGitSourceExclusionRequest,
  type UpdateGitSourceSettingsRequest,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function startGitHubProviderBootstrap(
  request: CompartmentRequester,
  input: GitHubProviderBootstrapRequest,
): Promise<GitHubProviderBootstrapResponse> {
  return await request<GitHubProviderBootstrapResponse, GitHubProviderBootstrapRequest>({
    body: input,
    method: 'POST',
    path: compartmentGitHubProviderBootstrapPathname,
    schema: gitHubProviderBootstrapResponseSchema,
  });
}

export async function getGitHubProviderBootstrapStatus(
  request: CompartmentRequester,
  bootstrapStateId: string,
): Promise<GitHubProviderBootstrapResponse> {
  return await request<GitHubProviderBootstrapResponse, undefined>({
    method: 'GET',
    path: `${compartmentGitHubProviderBootstrapPathname}/${encodeURIComponent(bootstrapStateId)}`,
    schema: gitHubProviderBootstrapResponseSchema,
  });
}

export async function listGitProviderRegistrationRepositories(
  request: CompartmentRequester,
  registrationId: string,
): Promise<GitProviderRegistrationRepositoryListResponse> {
  return await request<GitProviderRegistrationRepositoryListResponse, undefined>({
    method: 'GET',
    path: buildCompartmentGitProviderRegistrationRepositoriesPathname(registrationId),
    schema: gitProviderRegistrationRepositoryListResponseSchema,
  });
}

export async function createGitLabProviderRegistration(
  request: CompartmentRequester,
  input: CreateGitLabProviderRegistrationRequest,
): Promise<CreateGitProviderRegistrationResponse> {
  return await request<CreateGitProviderRegistrationResponse, CreateGitLabProviderRegistrationRequest>({
    body: input,
    method: 'POST',
    path: compartmentGitLabProviderRegistrationsPathname,
    schema: createGitProviderRegistrationResponseSchema,
  });
}

export async function listGitProviderRegistrations(
  request: CompartmentRequester,
): Promise<GitProviderRegistrationListResponse> {
  return await request<GitProviderRegistrationListResponse, undefined>({
    method: 'GET',
    path: compartmentGitProviderRegistrationsPathname,
    schema: gitProviderRegistrationListResponseSchema,
  });
}

export async function connectGitSource(
  request: CompartmentRequester,
  input: ConnectGitSourceRequest,
): Promise<GitSourceResponse> {
  return await request<GitSourceResponse, ConnectGitSourceRequest>({
    body: input,
    method: 'POST',
    path: compartmentGitSourceConnectPathname,
    schema: gitSourceResponseSchema,
  });
}

export async function listGitSources(request: CompartmentRequester): Promise<GitSourceListResponse> {
  return await request<GitSourceListResponse, undefined>({
    method: 'GET',
    path: compartmentSourcesPathname,
    schema: gitSourceListResponseSchema,
  });
}

export async function getGitSource(request: CompartmentRequester, sourceId: string): Promise<GitSourceResponse> {
  return await request<GitSourceResponse, undefined>({
    method: 'GET',
    path: `${compartmentSourcesPathname}/${encodeURIComponent(sourceId)}`,
    schema: gitSourceResponseSchema,
  });
}

export async function disconnectGitSource(
  request: CompartmentRequester,
  sourceId: string,
): Promise<DisconnectGitSourceResponse> {
  return await request<DisconnectGitSourceResponse, undefined>({
    method: 'DELETE',
    path: `${compartmentSourcesPathname}/${encodeURIComponent(sourceId)}`,
    schema: disconnectGitSourceResponseSchema,
  });
}

export async function getGitSourceSettings(
  request: CompartmentRequester,
  sourceId: string,
): Promise<GitSourceSettingsResponse> {
  return await request<GitSourceSettingsResponse, undefined>({
    method: 'GET',
    path: buildCompartmentGitSourceSettingsPathname(sourceId),
    schema: gitSourceSettingsResponseSchema,
  });
}

export async function updateGitSourceSettings(
  request: CompartmentRequester,
  sourceId: string,
  input: UpdateGitSourceSettingsRequest,
): Promise<GitSourceSettingsResponse> {
  return await request<GitSourceSettingsResponse, UpdateGitSourceSettingsRequest>({
    body: input,
    method: 'PATCH',
    path: buildCompartmentGitSourceSettingsPathname(sourceId),
    schema: gitSourceSettingsResponseSchema,
  });
}

export async function excludeGitSourceDescriptor(
  request: CompartmentRequester,
  sourceId: string,
  input: UpdateGitSourceExclusionRequest,
): Promise<GitSourceExclusionMutationResponse> {
  return await request<GitSourceExclusionMutationResponse, UpdateGitSourceExclusionRequest>({
    body: input,
    method: 'POST',
    path: buildCompartmentGitSourceExcludePathname(sourceId),
    schema: gitSourceExclusionMutationResponseSchema,
  });
}

export async function includeGitSourceDescriptor(
  request: CompartmentRequester,
  sourceId: string,
  input: UpdateGitSourceExclusionRequest,
): Promise<GitSourceSyncTaskResponse> {
  return await request<GitSourceSyncTaskResponse, UpdateGitSourceExclusionRequest>({
    body: input,
    method: 'POST',
    path: buildCompartmentGitSourceIncludePathname(sourceId),
    schema: gitSourceSyncTaskResponseSchema,
  });
}
