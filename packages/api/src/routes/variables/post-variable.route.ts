import { compartmentVariablesPathname, variableResponseSchema, type VariableResponse } from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import '../../http/request.types';
import { setVariableForPrincipal } from '../../services/variables.service';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { buildVariableResponse } from './variable.presenter';
import { variableSetRequestSchema, type SetVariableRequest } from './variable.route.types';

export function registerPostVariableRoute(app: ApiApp): void {
  app.post(
    compartmentVariablesPathname,
    createCurrentOrganizationRouteResponseOptions(undefined, { 200: variableResponseSchema }, 'variable.changed'),
    handlePostVariableRequest,
  );
}

async function handlePostVariableRequest(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const body: SetVariableRequest = parseRequestValue(variableSetRequestSchema, request.body, 'invalid_variable_body');
  const response: VariableResponse = await buildPostVariableResponse(request, body);

  return await reply.send(response);
}

async function buildPostVariableResponse(request: FastifyRequest, body: SetVariableRequest): Promise<VariableResponse> {
  return variableResponseSchema.parse(
    buildVariableResponse(
      await setVariableForPrincipal({
        environmentName: body.environmentName,
        fromResource: body.fromResource,
        keyName: body.keyName,
        organizationSlug: request.currentOrganization.slug,
        principalId: request.actor.principalId,
        projectName: body.projectName,
        resourceName: body.resourceName,
        sensitivity: body.sensitivity,
        serviceName: body.serviceName,
        value: body.value,
      }),
    ),
  );
}
