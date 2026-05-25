import {
  compartmentVariablePathnameTemplate,
  removeVariableResponseSchema,
  type RemoveVariableResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import '../../http/request.types';
import { removeVariableForPrincipal } from '../../services/variables.service';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { buildRemoveVariableResponse } from './variable.presenter';
import {
  variableQuerySchema,
  variableRouteParamsSchema,
  type VariableRouteParams,
  type VariableTargetQuery,
} from './variable.route.types';

export function registerDeleteVariableRoute(app: ApiApp): void {
  app.delete(
    compartmentVariablePathnameTemplate,
    createCurrentOrganizationRouteResponseOptions(undefined, { 200: removeVariableResponseSchema }),
    handleDeleteVariableRequest,
  );
}

async function handleDeleteVariableRequest(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: VariableRouteParams = parseRequestValue(
    variableRouteParamsSchema,
    request.params,
    'invalid_variable_params',
  );
  const query: VariableTargetQuery = parseRequestValue(variableQuerySchema, request.query, 'invalid_variable_query');
  await removeVariableForPrincipal({
    environmentName: query.environmentName,
    keyName: params.keyName,
    organizationSlug: request.currentOrganization.slug,
    principalId: request.actor.principalId,
    projectName: query.projectName,
    resourceName: query.resourceName,
    serviceName: query.serviceName,
  });
  const response: RemoveVariableResponse = removeVariableResponseSchema.parse(buildRemoveVariableResponse());

  return await reply.send(response);
}
