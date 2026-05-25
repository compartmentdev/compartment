import type { FastifyReply, FastifyRequest } from 'fastify';
import { parseRequestValue } from '../../http/validation';
import '../../http/request.types';
import type { ApiApp } from '../../app.types';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { createVariableGroupForPrincipal } from '../../services/variable-groups.service';
import { buildVariableGroupResponse } from './variable-group.presenter';
import { createVariableGroupBodySchema, type CreateVariableGroupRequest } from './variable-group.route.types';
import {
  compartmentVariableGroupsPathname,
  type VariableGroupResponse,
  variableGroupResponseSchema,
} from '@compartment/contracts';

export function registerPostVariableGroupRoute(app: ApiApp): void {
  app.post(
    compartmentVariableGroupsPathname,
    createCurrentOrganizationRouteResponseOptions('variable.write', { 200: variableGroupResponseSchema }),
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const body: CreateVariableGroupRequest = parseRequestValue(
        createVariableGroupBodySchema,
        request.body,
        'invalid_variable_group_body',
      );
      const response: VariableGroupResponse = variableGroupResponseSchema.parse(
        buildVariableGroupResponse(
          await createVariableGroupForPrincipal({
            description: body.description,
            organizationId: request.currentOrganization.id,
            principalId: request.actor.principalId,
            variableGroupName: body.variableGroupName,
          }),
        ),
      );

      return await reply.send(response);
    },
  );
}
