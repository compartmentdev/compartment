import {
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
  listGitLabRegistrationRepositories,
  listGitLabRegistrations,
} from '../../services/git-source/gitlab-registration.service';
import type { GitLabRegistrationView } from '../../services/git-source/gitlab-registration.service.types';
import type { GitRepositorySummary } from '../../services/git-source/git-source-provider.types';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import {
  gitHubProviderRegistrationRouteParamsSchema,
  type GitHubProviderRegistrationRouteParams,
} from './source-git.route.types';

export function registerGitLabSourceRoutes(app: ApiApp): void {
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
  app.get(
    `${compartmentGitLabProviderRegistrationsPathname}/:registrationId/repositories`,
    createCurrentOrganizationRouteResponseOptions('source.read', {
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
    registrations: await listGitLabRegistrations(request.currentOrganization.id),
  });
  return await reply.send(response);
}

async function handleRepositories(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: GitHubProviderRegistrationRouteParams = parseRequestValue(
    gitHubProviderRegistrationRouteParamsSchema,
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
