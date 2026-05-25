import {
  compartmentGitDescriptorPlanPathname,
  compartmentGitDescriptorPullRequestPathname,
  compartmentGitDescriptorPullRequestStatusPathname,
  compartmentGitHubProviderRegistrationRepositoriesPathnameTemplate,
  createGitDescriptorPullRequestRequestSchema,
  gitDescriptorPlanRequestSchema,
  gitDescriptorPlanResponseSchema,
  gitDescriptorPullRequestResponseSchema,
  gitDescriptorPullRequestStatusRequestSchema,
  gitDescriptorPullRequestStatusResponseSchema,
  gitHubInstallationRepositoryListRequestSchema,
  gitHubInstallationRepositoryListResponseSchema,
  type CreateGitDescriptorPullRequestRequest,
  type GitDescriptorPlanRequest,
  type GitDescriptorPlanResponse,
  type GitDescriptorPullRequestResponse,
  type GitDescriptorPullRequestStatusRequest,
  type GitDescriptorPullRequestStatusResponse,
  type GitHubInstallationRepositoryListRequest,
  type GitHubInstallationRepositoryListResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { gitSourceInvalidParamsErrorCode, gitSourceInvalidRequestErrorCode } from '../../git-source.constants';
import { parseRequestValue } from '../../http/validation';
import {
  createGitDescriptorPullRequest,
  readGitDescriptorPlan,
  readGitDescriptorPullRequestStatus,
} from '../../services/git-source/git-source-descriptor.service';
import {
  listGitHubInstallationRepositories,
  type ListGitHubInstallationRepositoriesInput,
} from '../../services/git-source/git-source-repository-list.service';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { buildGitSourceRouteContext } from './source-git-route-context';
import {
  gitHubProviderRegistrationRouteParamsSchema,
  type GitHubProviderRegistrationRouteParams,
} from './source-git.route.types';

export function registerGitSourceDescriptorRoutes(app: ApiApp): void {
  registerGitSourceDescriptorReadRoutes(app);
  registerGitSourceDescriptorWriteRoutes(app);
}

function registerGitSourceDescriptorReadRoutes(app: ApiApp): void {
  app.get(
    compartmentGitHubProviderRegistrationRepositoriesPathnameTemplate,
    createCurrentOrganizationRouteResponseOptions('source.manage', {
      200: gitHubInstallationRepositoryListResponseSchema,
    }),
    handleGitHubProviderRegistrationRepositories,
  );
  app.post(
    compartmentGitDescriptorPullRequestStatusPathname,
    createCurrentOrganizationRouteResponseOptions('source.manage', {
      200: gitDescriptorPullRequestStatusResponseSchema,
    }),
    handleGitDescriptorPullRequestStatus,
  );
}

function registerGitSourceDescriptorWriteRoutes(app: ApiApp): void {
  app.post(
    compartmentGitDescriptorPlanPathname,
    createCurrentOrganizationRouteResponseOptions('source.manage', { 200: gitDescriptorPlanResponseSchema }),
    handleGitDescriptorPlan,
  );
  app.post(
    compartmentGitDescriptorPullRequestPathname,
    createCurrentOrganizationRouteResponseOptions('source.manage', {
      200: gitDescriptorPullRequestResponseSchema,
    }),
    handleCreateGitDescriptorPullRequest,
  );
}

async function handleGitHubProviderRegistrationRepositories(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const input: ListGitHubInstallationRepositoriesInput = readGitHubInstallationRepositoryListInput(request);
  const response: GitHubInstallationRepositoryListResponse = gitHubInstallationRepositoryListResponseSchema.parse(
    await listGitHubInstallationRepositories(input),
  );
  return await reply.send(response);
}

function readGitHubInstallationRepositoryListInput(request: FastifyRequest): ListGitHubInstallationRepositoriesInput {
  const params: GitHubProviderRegistrationRouteParams = parseRequestValue(
    gitHubProviderRegistrationRouteParamsSchema,
    request.params,
    gitSourceInvalidParamsErrorCode,
  );
  const query: GitHubInstallationRepositoryListRequest = parseRequestValue(
    gitHubInstallationRepositoryListRequestSchema,
    request.query,
    gitSourceInvalidParamsErrorCode,
  );
  return {
    ...buildGitSourceRouteContext(request),
    providerHost: query.providerHost,
    registrationId: params.registrationId,
    repositoryOwner: query.repositoryOwner,
  };
}

async function handleGitDescriptorPlan(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const body: GitDescriptorPlanRequest = parseRequestValue(
    gitDescriptorPlanRequestSchema,
    request.body,
    gitSourceInvalidRequestErrorCode,
  );
  const response: GitDescriptorPlanResponse = gitDescriptorPlanResponseSchema.parse(
    await readGitDescriptorPlan({
      ...buildGitSourceRouteContext(request),
      request: body,
    }),
  );
  return await reply.send(response);
}

async function handleCreateGitDescriptorPullRequest(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const body: CreateGitDescriptorPullRequestRequest = parseRequestValue(
    createGitDescriptorPullRequestRequestSchema,
    request.body,
    gitSourceInvalidRequestErrorCode,
  );
  const response: GitDescriptorPullRequestResponse = gitDescriptorPullRequestResponseSchema.parse(
    await createGitDescriptorPullRequest({
      ...buildGitSourceRouteContext(request),
      request: body,
    }),
  );
  return await reply.send(response);
}

async function handleGitDescriptorPullRequestStatus(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const body: GitDescriptorPullRequestStatusRequest = parseRequestValue(
    gitDescriptorPullRequestStatusRequestSchema,
    request.body,
    gitSourceInvalidRequestErrorCode,
  );
  const response: GitDescriptorPullRequestStatusResponse = gitDescriptorPullRequestStatusResponseSchema.parse(
    await readGitDescriptorPullRequestStatus({
      ...buildGitSourceRouteContext(request),
      request: body,
    }),
  );
  return await reply.send(response);
}
