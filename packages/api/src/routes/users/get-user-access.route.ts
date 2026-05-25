import { userAccessDetailResponseSchema, type UserAccessDetailResponse } from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import '../../http/request.types';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { readOrganizationUserAccessDetail } from '../../services/access-assignments.service';
import type { UserAccessDetailResult } from '../../services/access-assignments.service.types';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { buildUserAccessDetailResponse } from '../assignments/assignment.presenter';
import { userRouteParamsSchema, type UserRouteParams } from './user.route.types';
import { userAccessApiPathname } from './users-api-paths';

export function registerGetUserAccessRoute(app: ApiApp): void {
  app.get(
    userAccessApiPathname,
    createCurrentOrganizationRouteResponseOptions('organization.user.read', {
      200: userAccessDetailResponseSchema,
    }),
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const params: UserRouteParams = parseRequestValue(userRouteParamsSchema, request.params, 'invalid_user_params');
      const access: UserAccessDetailResult = await readOrganizationUserAccessDetail(
        request.currentOrganization.id,
        params.email,
      );
      const response: UserAccessDetailResponse = userAccessDetailResponseSchema.parse(
        buildUserAccessDetailResponse(access),
      );

      return await reply.send(response);
    },
  );
}
