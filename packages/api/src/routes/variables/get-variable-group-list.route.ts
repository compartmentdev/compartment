import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  compartmentVariableGroupsPathname,
  variableGroupListResponseSchema,
  type VariableGroupListResponse,
} from '@compartment/contracts';
import type { ApiApp } from '../../app.types';
import '../../http/request.types';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { buildVariableGroupListResponse } from './variable-group.presenter';
import { listVariableGroupsForPrincipal } from '../../services/variable-groups.service';

export function registerGetVariableGroupListRoute(app: ApiApp): void {
  app.get(
    compartmentVariableGroupsPathname,
    createCurrentOrganizationRouteResponseOptions('variable.metadata.read', { 200: variableGroupListResponseSchema }),
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const response: VariableGroupListResponse = variableGroupListResponseSchema.parse(
        buildVariableGroupListResponse(
          await listVariableGroupsForPrincipal({
            organizationId: request.currentOrganization.id,
          }),
        ),
      );

      return await reply.send(response);
    },
  );
}
