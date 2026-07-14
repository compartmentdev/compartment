import {
  compartmentResourceLogsPathnameTemplate,
  resourceLogsResponseSchema,
  type ResourceLogsResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import '../../http/request.types';
import { parseRequestValue } from '../../http/validation';
import { getResourceLogsForPrincipal } from '../../services/resource-logs.service';
import { createCurrentOrganizationRouteOptions } from '../protected/current-organization-route';
import { requireAnyResourceAccess } from './resource-authorization';
import { buildResourceLogsResponse } from './resource.presenter';
import {
  resourceLogsRouteQuerySchema,
  resourceRouteParamsSchema,
  type ResourceLogsQuery,
  type ResourceRouteParams,
} from './resource.route.types';

export function registerGetResourceLogsRoute(app: ApiApp): void {
  app.get(
    compartmentResourceLogsPathnameTemplate,
    createCurrentOrganizationRouteOptions(),
    handleGetResourceLogsRequest,
  );
}

async function handleGetResourceLogsRequest(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  await requireAnyResourceAccess(request);
  const query: ResourceLogsQuery = parseResourceLogsQuery(request);
  const response: ResourceLogsResponse = resourceLogsResponseSchema.parse(
    buildResourceLogsResponse(
      await getResourceLogsForPrincipal({
        actorPrincipalId: request.actor.principalId,
        organizationSlug: request.currentOrganization.slug,
        query,
      }),
    ),
  );

  return await reply.send(response);
}

function parseResourceLogsQuery(request: FastifyRequest): ResourceLogsQuery {
  const params: ResourceRouteParams = parseRequestValue(
    resourceRouteParamsSchema,
    request.params,
    'invalid_resource_params',
  );

  return parseRequestValue(
    resourceLogsRouteQuerySchema,
    Object.assign({}, request.query, { resourceName: params.resourceName }),
    'invalid_resource_query',
  );
}
