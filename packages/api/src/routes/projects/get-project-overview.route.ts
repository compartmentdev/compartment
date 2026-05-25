import { projectOverviewResponseSchema, type ProjectOverviewResponse } from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import '../../http/request.types';
import { buildProjectOverviewResponse } from '../presenters/project.presenter';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { projectRouteParamsSchema, type ProjectRouteParams } from './project.route.types';
import { projectOverviewApiPathname } from './projects-api-paths';
import { getProjectOverviewForPrincipal } from '../../services/project-overview.service';

export function registerGetProjectOverviewRoute(app: ApiApp): void {
  app.get(
    projectOverviewApiPathname,
    createCurrentOrganizationRouteResponseOptions(undefined, { 200: projectOverviewResponseSchema }),
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const params: ProjectRouteParams = parseRequestValue(
        projectRouteParamsSchema,
        request.params,
        'invalid_project_params',
      );
      const response: ProjectOverviewResponse = projectOverviewResponseSchema.parse(
        buildProjectOverviewResponse(
          await getProjectOverviewForPrincipal({
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
