import {
  compartmentProjectsApiPathname,
  projectListResponseSchema,
  type ProjectListQuery,
  type ProjectListResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';
import { buildListPath } from './list-path.service';

export async function listProjects(
  request: CompartmentRequester,
  query: ProjectListQuery = {},
): Promise<ProjectListResponse> {
  return await request<ProjectListResponse, undefined>({
    method: 'GET',
    path: buildProjectListPath(query),
    schema: projectListResponseSchema,
  });
}

function buildProjectListPath(query: ProjectListQuery): string {
  return buildListPath(compartmentProjectsApiPathname, [
    { name: 'archiveState', value: query.archiveState },
    { name: 'detail', value: query.detail },
    { name: 'orderBy', value: query.orderBy },
    { name: 'page', value: query.page },
    { name: 'perPage', value: query.perPage },
    { name: 'projectIds', value: query.projectIds },
    { name: 'search', value: query.search },
    { name: 'sort', value: query.sort },
  ]);
}
