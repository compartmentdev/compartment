import { projectDeleteResponseSchema, type ProjectDeleteResponse } from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import '../../http/request.types';
import { deleteProjectForPrincipal } from '../../services/projects.service';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { projectRouteParamsSchema, type ProjectRouteParams } from './project.route.types';
import { projectApiPathname } from './projects-api-paths';

export function registerDeleteProjectRoute(app: ApiApp): void {
  app.delete(
    projectApiPathname,
    createCurrentOrganizationRouteResponseOptions(undefined, { 200: projectDeleteResponseSchema }),
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const params: ProjectRouteParams = parseRequestValue(
        projectRouteParamsSchema,
        request.params,
        'invalid_project_params',
      );
      const response: ProjectDeleteResponse = projectDeleteResponseSchema.parse({
        projectName: await deleteProjectForPrincipal({
          organizationSlug: request.currentOrganization.slug,
          principalId: request.actor.principalId,
          projectName: params.projectName,
        }),
      });

      return await reply.send(response);
    },
  );
}
