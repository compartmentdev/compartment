import {
  compartmentGitLabProviderRegistrationRepositoriesPathnameTemplate,
  compartmentGitLabProviderRegistrationsPathname,
  createGitLabProviderRegistrationRequestSchema,
  createGitLabProviderRegistrationResponseSchema,
  gitLabProviderRegistrationListResponseSchema,
  gitLabRegistrationRepositoryListResponseSchema,
  type CreateGitLabProviderRegistrationRequest,
  type CreateGitLabProviderRegistrationResponse,
  type GitLabProviderRegistrationListResponse,
  type GitLabRegistrationRepositoryListResponse,
  type GitProviderRepositorySummary,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { gitSourceInvalidParamsErrorCode, gitSourceInvalidRequestErrorCode } from '../../git-source.constants';
import { parseRequestValue } from '../../http/validation';
import {
  createGitLabRegistration,
  listActiveGitHubProviderHostsForOrganization,
  listGitLabRegistrationRepositories,
  listGitLabRegistrations,
} from '../../services/git-source/gitlab-registration.service';
import type { GitLabRegistrationView } from '../../services/git-source/gitlab-registration.service.types';
import type { GitRepositorySummary } from '../../services/git-source/git-source-provider.types';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import {
  gitProviderRegistrationRouteParamsSchema,
  type GitProviderRegistrationRouteParams,
} from './source-git.route.types';

export function registerGitLabSourceRoutes(app: ApiApp): void {
  // Token creation and repository enumeration are authenticated source.manage operations covered by
  // current-organization rate limiting. They do not authenticate a Compartment principal, so no
  // additional authentication cooldown applies to their outbound GitLab credential validation.
  app.post(
    compartmentGitLabProviderRegistrationsPathname,
    createCurrentOrganizationRouteResponseOptions('source.manage', {
      200: createGitLabProviderRegistrationResponseSchema,
    }),
    handleCreate,
  );
  app.get(
    compartmentGitLabProviderRegistrationsPathname,
    createCurrentOrganizationRouteResponseOptions('source.read', { 200: gitLabProviderRegistrationListResponseSchema }),
    handleList,
  );
  // Repository enumeration exercises the stored access token, so it requires the
  // same manage permission as the GitHub registration repositories route; the
  // registrations list above exposes only host + token-holder metadata and stays
  // readable to source.read principals.
  app.get(
    compartmentGitLabProviderRegistrationRepositoriesPathnameTemplate,
    createCurrentOrganizationRouteResponseOptions('source.manage', {
      200: gitLabRegistrationRepositoryListResponseSchema,
    }),
    handleRepositories,
  );
}

async function handleCreate(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const body: CreateGitLabProviderRegistrationRequest = parseRequestValue(
    createGitLabProviderRegistrationRequestSchema,
    request.body,
    gitSourceInvalidRequestErrorCode,
  );
  const registration: GitLabRegistrationView = await createGitLabRegistration({
    actorPrincipalId: request.actor.principalId,
    organizationId: request.currentOrganization.id,
    request: body,
  });
  const response: CreateGitLabProviderRegistrationResponse = createGitLabProviderRegistrationResponseSchema.parse({
    registration,
  });
  return await reply.send(response);
}

async function handleList(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const response: GitLabProviderRegistrationListResponse = gitLabProviderRegistrationListResponseSchema.parse({
    // Temporary multi-provider bridge; replace with provider-neutral active registrations before provider three.
    activeGitHubProviderHosts: await listActiveGitHubProviderHostsForOrganization(request.currentOrganization.id),
    registrations: await listGitLabRegistrations(request.currentOrganization.id),
  });
  return await reply.send(response);
}

async function handleRepositories(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: GitProviderRegistrationRouteParams = parseRequestValue(
    gitProviderRegistrationRouteParamsSchema,
    request.params,
    gitSourceInvalidParamsErrorCode,
  );
  const repositories: GitRepositorySummary[] = await listGitLabRegistrationRepositories(
    request.currentOrganization.id,
    params.registrationId,
  );
  const response: GitLabRegistrationRepositoryListResponse = gitLabRegistrationRepositoryListResponseSchema.parse({
    repositories: repositories.map(toRepositorySummary),
  });
  return await reply.send(response);
}

function toRepositorySummary(repository: GitRepositorySummary): GitProviderRepositorySummary {
  return {
    defaultBranchName: repository.defaultBranchName,
    fullName: repository.fullName,
    id: repository.repositoryExternalId,
    name: repository.repositoryName,
    owner: repository.repositoryOwner,
    private: repository.private,
  };
}
