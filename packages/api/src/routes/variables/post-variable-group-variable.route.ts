import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  compartmentVariableGroupVariablesPathname,
  type VariableGroupResponse,
  variableGroupResponseSchema,
} from '@compartment/contracts';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import '../../http/request.types';
import { putVariableGroupVariableForPrincipal } from '../../services/variable-groups.service';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { buildVariableGroupResponse } from './variable-group.presenter';
import { putVariableGroupVariableBodySchema, type PutVariableGroupVariableRequest } from './variable-group.route.types';

export function registerPostVariableGroupVariableRoute(app: ApiApp): void {
  app.post(
    compartmentVariableGroupVariablesPathname,
    createCurrentOrganizationRouteResponseOptions('variable.write', { 200: variableGroupResponseSchema }),
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      await reply.send(await executePostVariableGroupVariableRequest(request)),
  );
}

async function executePostVariableGroupVariableRequest(request: FastifyRequest): Promise<VariableGroupResponse> {
  const body: PutVariableGroupVariableRequest = parseRequestValue(
    putVariableGroupVariableBodySchema,
    request.body,
    'invalid_variable_group_body',
  );

  return variableGroupResponseSchema.parse(
    buildVariableGroupResponse(
      await putVariableGroupVariableForPrincipal({
        keyName: body.keyName,
        organizationId: request.currentOrganization.id,
        principalId: request.actor.principalId,
        sensitivity: body.sensitivity,
        value: body.value,
        variableGroupName: body.variableGroupName,
      }),
    ),
  );
}
