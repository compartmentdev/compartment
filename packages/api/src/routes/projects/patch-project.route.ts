import {
  projectResponseSchema,
  renameProjectRequestSchema,
  type ProjectResponse,
  type RenameProjectRequest,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import '../../http/request.types';
import { renameProjectForPrincipal } from '../../services/projects.service';
import { buildProjectResponse } from '../presenters/project.presenter';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { projectRouteParamsSchema, type ProjectRouteParams } from './project.route.types';
import { projectApiPathname } from './projects-api-paths';

export function registerPatchProjectRoute(app: ApiApp): void {
  app.patch(
    projectApiPathname,
    createCurrentOrganizationRouteResponseOptions(undefined, { 200: projectResponseSchema }),
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      await executePatchProjectRoute(request, reply),
  );
}

async function executePatchProjectRoute(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: ProjectRouteParams = parseRequestValue(
    projectRouteParamsSchema,
    request.params,
    'invalid_project_params',
  );
  const body: RenameProjectRequest = parseRequestValue(
    renameProjectRequestSchema,
    request.body,
    'invalid_rename_project_request',
  );
  const response: ProjectResponse = projectResponseSchema.parse(
    buildProjectResponse(
      await renameProjectForPrincipal({
        nextProjectName: body.name,
        organizationSlug: request.currentOrganization.slug,
        principalId: request.actor.principalId,
        projectName: params.projectName,
      }),
    ),
  );

  return await reply.send(response);
}
