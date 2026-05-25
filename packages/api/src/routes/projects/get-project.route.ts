import { projectReadResponseSchema, type ProjectReadResponse } from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import '../../http/request.types';
import { getActiveProjectForPrincipal } from '../../services/projects.service';
import { buildProjectReadResponse } from '../presenters/project.presenter';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { projectRouteParamsSchema, type ProjectRouteParams } from './project.route.types';
import { projectApiPathname } from './projects-api-paths';

export function registerGetProjectRoute(app: ApiApp): void {
  app.get(
    projectApiPathname,
    createCurrentOrganizationRouteResponseOptions(undefined, { 200: projectReadResponseSchema }),
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const params: ProjectRouteParams = parseRequestValue(
        projectRouteParamsSchema,
        request.params,
        'invalid_project_params',
      );
      const response: ProjectReadResponse = projectReadResponseSchema.parse(
        buildProjectReadResponse(
          await getActiveProjectForPrincipal({
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
