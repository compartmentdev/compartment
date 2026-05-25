import {
  compartmentResourceOutputPathnameTemplate,
  compartmentResourceOutputsPathnameTemplate,
  resourceOutputListResponseSchema,
  resourceOutputResponseSchema,
  type ResourceOutputListResponse,
  type ResourceOutputResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import '../../http/request.types';
import { getResourceOutputForPrincipal, listResourceOutputsForPrincipal } from '../../services/resources.service';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { requireAnyResourceAccess } from './resource-authorization';
import { parseResourceTargetQuery } from './resource-get.route';
import { buildResourceOutputListResponse, buildResourceOutputResponse } from './resource.presenter';
import {
  resourceOutputRouteParamsSchema,
  resourceOutputRouteQuerySchema,
  type ResourceOutputRouteParams,
  type ResourceOutputQuery,
  type ResourceTargetQuery,
} from './resource.route.types';

interface ResourceOutputRawQuery {
  reveal?: boolean | string | undefined;
}

export function registerResourceOutputRoutes(app: ApiApp): void {
  app.get(
    compartmentResourceOutputsPathnameTemplate,
    createCurrentOrganizationRouteResponseOptions(undefined, { 200: resourceOutputListResponseSchema }),
    handleGetResourceOutputList,
  );
  app.get(
    compartmentResourceOutputPathnameTemplate,
    createCurrentOrganizationRouteResponseOptions(undefined, { 200: resourceOutputResponseSchema }),
    handleGetResourceOutput,
  );
}

async function handleGetResourceOutputList(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  await requireAnyResourceAccess(request);
  const query: ResourceTargetQuery = parseResourceTargetQuery(request);
  const response: ResourceOutputListResponse = resourceOutputListResponseSchema.parse(
    buildResourceOutputListResponse(
      await listResourceOutputsForPrincipal({
        actorPrincipalId: request.actor.principalId,
        organizationSlug: request.currentOrganization.slug,
        query,
      }),
    ),
  );

  return await reply.send(response);
}

async function handleGetResourceOutput(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  await requireAnyResourceAccess(request);
  const params: ResourceOutputRouteParams = parseRequestValue(
    resourceOutputRouteParamsSchema,
    request.params,
    'invalid_resource_params',
  );
  const query: ResourceOutputQuery = parseResourceOutputQuery(request, params);
  const response: ResourceOutputResponse = resourceOutputResponseSchema.parse(
    buildResourceOutputResponse(
      await getResourceOutputForPrincipal({
        actorPrincipalId: request.actor.principalId,
        organizationSlug: request.currentOrganization.slug,
        query,
      }),
    ),
  );

  return await reply.send(response);
}

function parseResourceOutputQuery(request: FastifyRequest, params: ResourceOutputRouteParams): ResourceOutputQuery {
  const rawQuery: ResourceOutputRawQuery = request.query as ResourceOutputRawQuery;
  const targetQuery: ResourceTargetQuery = parseResourceTargetQuery(request, {
    ignoredParamKeys: ['outputName'],
    ignoredQueryKeys: ['reveal'],
  });

  return resourceOutputRouteQuerySchema.parse({
    ...targetQuery,
    outputName: params.outputName,
    reveal: rawQuery.reveal,
  });
}
