import {
  buildCompartmentGitHubProviderRegistrationRepositoriesPathname,
  buildCompartmentGitLabProviderRegistrationRepositoriesPathname,
  buildCompartmentGitSourceExcludePathname,
  buildCompartmentGitSourceIncludePathname,
  buildCompartmentGitSourceSettingsPathname,
  compartmentGitHubProviderBootstrapPathname,
  compartmentGitLabProviderRegistrationsPathname,
  compartmentGitSourceConnectPathname,
  compartmentSourcesPathname,
  disconnectGitSourceResponseSchema,
  gitHubInstallationRepositoryListRequestSchema,
  gitSourceExclusionMutationResponseSchema,
  gitHubInstallationRepositoryListResponseSchema,
  gitHubProviderBootstrapResponseSchema,
  createGitLabProviderRegistrationResponseSchema,
  gitLabProviderRegistrationListResponseSchema,
  gitLabRegistrationRepositoryListResponseSchema,
  gitSourceListResponseSchema,
  gitSourceResponseSchema,
  gitSourceSettingsResponseSchema,
  gitSourceSyncTaskResponseSchema,
  type ConnectGitSourceRequest,
  type CreateGitLabProviderRegistrationRequest,
  type CreateGitLabProviderRegistrationResponse,
  type DisconnectGitSourceResponse,
  type GitSourceExclusionMutationResponse,
  type GitHubInstallationRepositoryListRequest,
  type GitHubInstallationRepositoryListResponse,
  type GitHubProviderBootstrapRequest,
  type GitHubProviderBootstrapResponse,
  type GitLabProviderRegistrationListResponse,
  type GitLabRegistrationRepositoryListResponse,
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

export async function listGitHubInstallationRepositories(
  request: CompartmentRequester,
  registrationId: string,
  input: GitHubInstallationRepositoryListRequest,
): Promise<GitHubInstallationRepositoryListResponse> {
  const query: GitHubInstallationRepositoryListRequest = gitHubInstallationRepositoryListRequestSchema.parse(input);
  return await request<GitHubInstallationRepositoryListResponse, undefined>({
    method: 'GET',
    path: buildCompartmentGitHubProviderRegistrationRepositoriesPathname(registrationId, query),
    schema: gitHubInstallationRepositoryListResponseSchema,
  });
}

export async function createGitLabProviderRegistration(
  request: CompartmentRequester,
  input: CreateGitLabProviderRegistrationRequest,
): Promise<CreateGitLabProviderRegistrationResponse> {
  return await request<CreateGitLabProviderRegistrationResponse, CreateGitLabProviderRegistrationRequest>({
    body: input,
    method: 'POST',
    path: compartmentGitLabProviderRegistrationsPathname,
    schema: createGitLabProviderRegistrationResponseSchema,
  });
}

export async function listGitLabProviderRegistrations(
  request: CompartmentRequester,
): Promise<GitLabProviderRegistrationListResponse> {
  return await request<GitLabProviderRegistrationListResponse, undefined>({
    method: 'GET',
    path: compartmentGitLabProviderRegistrationsPathname,
    schema: gitLabProviderRegistrationListResponseSchema,
  });
}

export async function listGitLabRegistrationRepositories(
  request: CompartmentRequester,
  registrationId: string,
): Promise<GitLabRegistrationRepositoryListResponse> {
  return await request<GitLabRegistrationRepositoryListResponse, undefined>({
    method: 'GET',
    path: buildCompartmentGitLabProviderRegistrationRepositoriesPathname(registrationId),
    schema: gitLabRegistrationRepositoryListResponseSchema,
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
