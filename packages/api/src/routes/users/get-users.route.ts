import {
  userListQuerySchema,
  userListResponseSchema,
  type UserListQuery,
  type UserListResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import '../../http/request.types';
import { listUsersInOrganization } from '../../services/organization-users.service';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { buildUserListResponse } from './user.presenter';
import { usersApiPathname } from './users-api-paths';

export function registerGetUsersRoute(app: ApiApp): void {
  app.get(
    usersApiPathname,
    createCurrentOrganizationRouteResponseOptions('organization.user.read', { 200: userListResponseSchema }),
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const query: UserListQuery = parseRequestValue(userListQuerySchema, request.query, 'invalid_user_list_query');
      const response: UserListResponse = userListResponseSchema.parse(
        buildUserListResponse(
          await listUsersInOrganization({
            orderBy: query.orderBy,
            organizationId: request.currentOrganization.id,
            page: query.page,
            perPage: query.perPage,
            search: query.search,
            sort: query.sort,
          }),
        ),
      );

      return await reply.send(response);
    },
  );
}
