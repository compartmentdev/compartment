import {
  compartmentGitDescriptorPlanPathname,
  compartmentGitDescriptorPullRequestPathname,
  compartmentGitDescriptorPullRequestStatusPathname,
  compartmentGitProviderRegistrationRepositoriesPathnameTemplate,
  compartmentGitProviderRegistrationsPathname,
  createGitDescriptorPullRequestRequestSchema,
  gitDescriptorPlanRequestSchema,
  gitDescriptorPlanResponseSchema,
  gitDescriptorPullRequestResponseSchema,
  gitDescriptorPullRequestStatusRequestSchema,
  gitDescriptorPullRequestStatusResponseSchema,
  gitProviderRegistrationListResponseSchema,
  gitProviderRegistrationRepositoryListResponseSchema,
  type CreateGitDescriptorPullRequestRequest,
  type GitDescriptorPlanRequest,
  type GitDescriptorPlanResponse,
  type GitDescriptorPullRequestResponse,
  type GitDescriptorPullRequestStatusRequest,
  type GitDescriptorPullRequestStatusResponse,
  type GitProviderRegistrationListResponse,
  type GitProviderRegistrationRepositoryListResponse,
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
import { listGitProviderRegistrationRepositories } from '../../services/git-source/git-source-repository-list.service';
import { listGitProviderRegistrations } from '../../services/git-source/git-source-provider-registration.service';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { buildGitSourceRouteContext } from './source-git-route-context';
import {
  gitProviderRegistrationRouteParamsSchema,
  type GitProviderRegistrationRouteParams,
} from './source-git.route.types';

export function registerGitSourceDescriptorRoutes(app: ApiApp): void {
  registerGitSourceDescriptorReadRoutes(app);
  registerGitSourceDescriptorWriteRoutes(app);
}

function registerGitSourceDescriptorReadRoutes(app: ApiApp): void {
  app.get(
    compartmentGitProviderRegistrationsPathname,
    createCurrentOrganizationRouteResponseOptions('source.read', {
      200: gitProviderRegistrationListResponseSchema,
    }),
    handleGitProviderRegistrations,
  );
  app.get(
    compartmentGitProviderRegistrationRepositoriesPathnameTemplate,
    createCurrentOrganizationRouteResponseOptions('source.manage', {
      200: gitProviderRegistrationRepositoryListResponseSchema,
    }),
    handleGitProviderRegistrationRepositories,
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

async function handleGitProviderRegistrations(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const response: GitProviderRegistrationListResponse = gitProviderRegistrationListResponseSchema.parse({
    registrations: await listGitProviderRegistrations(request.currentOrganization.id),
  });
  return await reply.send(response);
}

async function handleGitProviderRegistrationRepositories(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const params: GitProviderRegistrationRouteParams = parseRequestValue(
    gitProviderRegistrationRouteParamsSchema,
    request.params,
    gitSourceInvalidParamsErrorCode,
  );
  const response: GitProviderRegistrationRepositoryListResponse =
    gitProviderRegistrationRepositoryListResponseSchema.parse(
      await listGitProviderRegistrationRepositories({
        ...buildGitSourceRouteContext(request),
        registrationId: params.registrationId,
      }),
    );
  return await reply.send(response);
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
