import {
  projectLifecycleRequestSchema,
  projectLifecycleResponseSchema,
  resolveCompartmentEnvironmentName,
  type ProjectLifecycleRequest,
  type ProjectLifecycleResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import '../../http/request.types';
import { requireActiveProjectMutationRouteResult } from '../deployment-project-mutation-route.helpers';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { buildProjectLifecycleResponse } from './project-lifecycle.presenter';
import type {
  ProjectLifecycleRouteExecutor,
  ProjectLifecycleRouteInput,
} from './project-lifecycle-route.helpers.types';
import { projectRouteParamsSchema, type ProjectRouteParams } from './project.route.types';

export function registerPostProjectLifecycleRoute(
  app: ApiApp,
  path: string,
  executeLifecycle: ProjectLifecycleRouteExecutor,
): void {
  app.post(
    path,
    createCurrentOrganizationRouteResponseOptions(undefined, { 200: projectLifecycleResponseSchema }),
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      return await handlePostProjectLifecycle(request, reply, executeLifecycle);
    },
  );
}

async function handlePostProjectLifecycle(
  request: FastifyRequest,
  reply: FastifyReply,
  executeLifecycle: ProjectLifecycleRouteExecutor,
): Promise<FastifyReply> {
  const response: ProjectLifecycleResponse = projectLifecycleResponseSchema.parse(
    buildProjectLifecycleResponse(
      requireActiveProjectMutationRouteResult(await executeLifecycle(createProjectLifecycleRouteInput(request))),
    ),
  );

  return await reply.send(response);
}

function createProjectLifecycleRouteInput(request: FastifyRequest): ProjectLifecycleRouteInput {
  const params: ProjectRouteParams = parseRequestValue(
    projectRouteParamsSchema,
    request.params,
    'invalid_project_params',
  );
  const input: ProjectLifecycleRequest = parseRequestValue(
    projectLifecycleRequestSchema,
    request.body,
    'invalid_project_lifecycle_request',
  );

  return {
    environmentName: resolveCompartmentEnvironmentName(input.environmentName),
    organizationSlug: request.currentOrganization.slug,
    principalId: request.actor.principalId,
    projectName: params.projectName,
  };
}
