import {
  compartmentVariablePathnameTemplate,
  variableResponseSchema,
  type VariableResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import '../../http/request.types';
import { showVariableForPrincipal } from '../../services/variables.service';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { buildVariableResponse } from './variable.presenter';
import {
  variableQuerySchema,
  variableRouteParamsSchema,
  type VariableRouteParams,
  type VariableTargetQuery,
} from './variable.route.types';

export function registerGetVariableRoute(app: ApiApp): void {
  app.get(
    compartmentVariablePathnameTemplate,
    createCurrentOrganizationRouteResponseOptions(undefined, { 200: variableResponseSchema }),
    handleGetVariableRequest,
  );
}

async function handleGetVariableRequest(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: VariableRouteParams = parseRequestValue(
    variableRouteParamsSchema,
    request.params,
    'invalid_variable_params',
  );
  const query: VariableTargetQuery = parseRequestValue(variableQuerySchema, request.query, 'invalid_variable_query');
  const response: VariableResponse = await buildGetVariableResponse(request, params, query);

  return await reply.send(response);
}

async function buildGetVariableResponse(
  request: FastifyRequest,
  params: VariableRouteParams,
  query: VariableTargetQuery,
): Promise<VariableResponse> {
  return variableResponseSchema.parse(
    buildVariableResponse(
      await showVariableForPrincipal({
        environmentName: query.environmentName,
        keyName: params.keyName,
        organizationSlug: request.currentOrganization.slug,
        principalId: request.actor.principalId,
        projectName: query.projectName,
        resourceName: query.resourceName,
        serviceName: query.serviceName,
      }),
    ),
  );
}
