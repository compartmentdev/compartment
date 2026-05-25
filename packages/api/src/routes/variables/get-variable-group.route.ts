import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  compartmentVariableGroupPathnameTemplate,
  variableGroupResponseSchema,
  type VariableGroupResponse,
} from '@compartment/contracts';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import '../../http/request.types';
import { showVariableGroupForPrincipal } from '../../services/variable-groups.service';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { buildVariableGroupResponse } from './variable-group.presenter';
import { variableGroupRouteParamsSchema, type VariableGroupRouteParams } from './variable-group.route.types';

export function registerGetVariableGroupRoute(app: ApiApp): void {
  app.get(
    compartmentVariableGroupPathnameTemplate,
    createCurrentOrganizationRouteResponseOptions('variable.metadata.read', { 200: variableGroupResponseSchema }),
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const params: VariableGroupRouteParams = parseRequestValue(
        variableGroupRouteParamsSchema,
        request.params,
        'invalid_variable_group_params',
      );
      const response: VariableGroupResponse = variableGroupResponseSchema.parse(
        buildVariableGroupResponse(
          await showVariableGroupForPrincipal({
            organizationId: request.currentOrganization.id,
            principalId: request.actor.principalId,
            variableGroupName: params.variableGroupName,
          }),
        ),
      );

      return await reply.send(response);
    },
  );
}
