import { projectResponseSchema, type ProjectResponse } from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import '../../http/request.types';
import { archiveProjectForPrincipal } from '../../services/projects.service';
import { buildProjectResponse } from '../presenters/project.presenter';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { projectRouteParamsSchema, type ProjectRouteParams } from './project.route.types';
import { projectArchiveApiPathname } from './projects-api-paths';

export function registerPostArchiveProjectRoute(app: ApiApp): void {
  app.post(
    projectArchiveApiPathname,
    createCurrentOrganizationRouteResponseOptions(undefined, { 200: projectResponseSchema }),
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const params: ProjectRouteParams = parseRequestValue(
        projectRouteParamsSchema,
        request.params,
        'invalid_project_params',
      );
      const response: ProjectResponse = projectResponseSchema.parse(
        buildProjectResponse(
          await archiveProjectForPrincipal({
            organizationSlug: request.currentOrganization.slug,
            principalId: request.actor.principalId,
            projectName: params.projectName,
          }),
        ),
      );

      return await reply.send(response);
    },
  );
}
