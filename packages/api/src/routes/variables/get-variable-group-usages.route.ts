import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  compartmentVariableGroupUsagesPathnameTemplate,
  variableGroupUsagesResponseSchema,
  type VariableGroupUsagesResponse,
} from '@compartment/contracts';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import '../../http/request.types';
import { listVariableGroupUsagesForPrincipal } from '../../services/variable-groups.service';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { buildVariableGroupUsagesResponse } from './variable-group.presenter';
import { variableGroupRouteParamsSchema, type VariableGroupRouteParams } from './variable-group.route.types';

export function registerGetVariableGroupUsagesRoute(app: ApiApp): void {
  app.get(
    compartmentVariableGroupUsagesPathnameTemplate,
    createCurrentOrganizationRouteResponseOptions('variable.metadata.read', {
      200: variableGroupUsagesResponseSchema,
    }),
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const params: VariableGroupRouteParams = parseRequestValue(
        variableGroupRouteParamsSchema,
        request.params,
        'invalid_variable_group_params',
      );
      const response: VariableGroupUsagesResponse = variableGroupUsagesResponseSchema.parse(
        buildVariableGroupUsagesResponse(
          await listVariableGroupUsagesForPrincipal({
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
