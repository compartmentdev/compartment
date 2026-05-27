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
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { parseRequestValue } from '../../http/validation';
import { listOrganizationAccessGroups, listOrganizationAccessGroupsPage } from '../../services/access-groups.service';
import type {
  AccessGroupListRowResult,
  OrganizationAccessGroupsPageResult,
} from '../../services/access-groups.service.types';
import { buildAccessGroupListRows } from './group.presenter';

export async function handleGroupList(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const query: AccessGroupListQuery = parseRequestValue(
    accessGroupListQuerySchema,
    request.query,
    'invalid_group_query',
  );
  if (query.detail === 'list') {
    return await reply.send(await buildGroupListPageResponse(request, query));
  }
  if (query.detail === 'options') {
    const groups: AccessGroupListRowResult[] = await listOrganizationAccessGroups(request.currentOrganization.id);
    const response: AccessGroupListOptionsResponse = accessGroupListOptionsResponseSchema.parse({
      detail: 'options',
      groups: buildAccessGroupListRows(groups),
    });
    return await reply.send(response);
  }

  const groups: AccessGroupListRowResult[] = await listOrganizationAccessGroups(request.currentOrganization.id);
  const response: AccessGroupListResponse = accessGroupListResponseSchema.parse({
    groups: buildAccessGroupListRows(groups),
  });
  return await reply.send(response);
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
