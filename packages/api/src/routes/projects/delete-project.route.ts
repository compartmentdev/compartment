import { projectDeleteResponseSchema, type ProjectDeleteResponse } from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import '../../http/request.types';
import { deleteProjectForPrincipal } from '../../services/projects.service';
import type { ProjectDeleteResult } from '../../services/projects.service.types';
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
      const result: ProjectDeleteResult = await deleteProjectForPrincipal({
        organizationSlug: request.currentOrganization.slug,
        principalId: request.actor.principalId,
        projectName: params.projectName,
      });
      logRecoveredProjectTeardown(request, result);
      const response: ProjectDeleteResponse = projectDeleteResponseSchema.parse({ projectName: result.projectName });

      return await reply.send(response);
    },
  );
}

function logRecoveredProjectTeardown(request: FastifyRequest, result: ProjectDeleteResult): void {
  if (result.recoveredTerminalFailureMessage !== null) {
    request.log.warn(
      { failureMessage: result.recoveredTerminalFailureMessage, projectName: result.projectName },
      'Retrying a terminally failed project Kubernetes teardown.',
    );
  }
}
