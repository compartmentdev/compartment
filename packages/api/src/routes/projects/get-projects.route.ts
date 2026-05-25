import {
  projectListQuerySchema,
  projectListResponseSchema,
  type ProjectListQuery,
  type ProjectListResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import '../../http/request.types';
import { buildProjectListResponse } from '../presenters/project.presenter';
import { listProjectListForPrincipal } from '../../services/project-list.service';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { projectsApiPathname } from './projects-api-paths';

export function registerGetProjectsRoute(app: ApiApp): void {
  app.get(
    projectsApiPathname,
    createCurrentOrganizationRouteResponseOptions(undefined, { 200: projectListResponseSchema }),
    handleGetProjects,
  );
}

async function handleGetProjects(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const query: ProjectListQuery = parseRequestValue(
    projectListQuerySchema,
    request.query,
    'invalid_project_list_query',
  );
  const response: ProjectListResponse = projectListResponseSchema.parse(
    buildProjectListResponse(
      await listProjectListForPrincipal({
        archiveState: query.archiveState,
        detail: query.detail,
        orderBy: query.orderBy,
        organizationSlug: request.currentOrganization.slug,
        page: query.page,
        perPage: query.perPage,
        principalId: request.actor.principalId,
        projectIds: query.projectIds,
        search: query.search,
        sort: query.sort,
      }),
    ),
  );

  return await reply.send(response);
}
