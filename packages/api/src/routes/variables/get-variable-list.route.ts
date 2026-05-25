import {
  compartmentVariablesPathname,
  variableListResponseSchema,
  type VariableListResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import '../../http/request.types';
import { listVariablesForPrincipal } from '../../services/variables.service';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { buildVariableListResponse } from './variable.presenter';
import { variableQuerySchema, type VariableTargetQuery } from './variable.route.types';

export function registerGetVariableListRoute(app: ApiApp): void {
  app.get(
    compartmentVariablesPathname,
    createCurrentOrganizationRouteResponseOptions(undefined, { 200: variableListResponseSchema }),
    handleGetVariableListRoute,
  );
}

async function handleGetVariableListRoute(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const query: VariableTargetQuery = parseRequestValue(variableQuerySchema, request.query, 'invalid_variable_query');
  const response: VariableListResponse = variableListResponseSchema.parse(
    buildVariableListResponse(
      await listVariablesForPrincipal({
        environmentName: query.environmentName,
        organizationSlug: request.currentOrganization.slug,
        principalId: request.actor.principalId,
        projectName: query.projectName,
        resourceName: query.resourceName,
        serviceName: query.serviceName,
      }),
    ),
  );

  return await reply.send(response);
}
