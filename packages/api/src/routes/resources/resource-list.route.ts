import {
  compartmentResourcesPathname,
  resourceListResponseSchema,
  type ResourceListResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import '../../http/request.types';
import { parseRequestValue } from '../../http/validation';
import { listResourcesForPrincipal } from '../../services/resources.service';
import { createCurrentOrganizationRouteOptions } from '../protected/current-organization-route';
import { requireAnyResourceAccess } from './resource-authorization';
import { buildResourceListResponse } from './resource.presenter';
import { resourceListRouteQuerySchema, type ResourceListQuery } from './resource.route.types';

export function registerGetResourceListRoute(app: ApiApp): void {
  app.get(compartmentResourcesPathname, createCurrentOrganizationRouteOptions(), handleGetResourceListRequest);
}

async function handleGetResourceListRequest(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  await requireAnyResourceAccess(request);
  const query: ResourceListQuery = parseRequestValue(
    resourceListRouteQuerySchema,
    request.query,
    'invalid_resource_query',
  );
  const response: ResourceListResponse = resourceListResponseSchema.parse(
    buildResourceListResponse(
      await listResourcesForPrincipal({
        actorPrincipalId: request.actor.principalId,
        organizationSlug: request.currentOrganization.slug,
        query,
      }),
    ),
  );

  return await reply.send(response);
}
