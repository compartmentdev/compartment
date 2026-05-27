import {
  accessGroupListOptionsResponseSchema,
  accessGroupListPageResponseSchema,
  accessGroupListQuerySchema,
  accessGroupListResponseSchema,
  type AccessGroupListPageResponse,
  type AccessGroupListPageQuery,
  type AccessGroupListQuery,
  type AccessGroupListOptionsResponse,
  type AccessGroupListResponse,
  type AccessGroupListRouteResponse,
  type AccessGroupListRow,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { parseRequestValue } from '../../http/validation';
import { listOrganizationAccessGroups, listOrganizationAccessGroupsPage } from '../../services/access-groups.service';
import type { OrganizationAccessGroupsPageResult } from '../../services/access-groups.service.types';
import { buildAccessGroupListRows } from './group.presenter';

export async function handleGroupList(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const query: AccessGroupListQuery = parseRequestValue(
    accessGroupListQuerySchema,
    request.query,
    'invalid_group_query',
  );
  const response: AccessGroupListRouteResponse = await buildGroupListResponse(request, query);

  return await reply.send(response);
}

async function buildGroupListResponse(
  request: FastifyRequest,
  query: AccessGroupListQuery,
): Promise<AccessGroupListRouteResponse> {
  if (query.detail === 'list') {
    return await buildGroupListPageResponse(request, query);
  }
  if (query.detail === 'options') {
    return await buildGroupListOptionsResponse(request);
  }

  return await buildGroupListLegacyResponse(request);
}

async function buildGroupListPageResponse(
  request: FastifyRequest,
  query: AccessGroupListPageQuery,
): Promise<AccessGroupListPageResponse> {
  const page: OrganizationAccessGroupsPageResult = await listOrganizationAccessGroupsPage({
    organizationId: request.currentOrganization.id,
    orderBy: query.orderBy,
    page: query.page,
    perPage: query.perPage,
    search: query.search,
    sort: query.sort,
  });

  return accessGroupListPageResponseSchema.parse({
    detail: 'list',
    groups: buildAccessGroupListRows(page.groups),
    pagination: page.pagination,
  });
}

async function buildGroupListOptionsResponse(request: FastifyRequest): Promise<AccessGroupListOptionsResponse> {
  const groups: AccessGroupListRow[] = await listOrganizationAccessGroups(request.currentOrganization.id);

  return accessGroupListOptionsResponseSchema.parse({
    detail: 'options',
    groups,
  });
}

async function buildGroupListLegacyResponse(request: FastifyRequest): Promise<AccessGroupListResponse> {
  const groups: AccessGroupListRow[] = await listOrganizationAccessGroups(request.currentOrganization.id);

  return accessGroupListResponseSchema.parse({ groups });
}
