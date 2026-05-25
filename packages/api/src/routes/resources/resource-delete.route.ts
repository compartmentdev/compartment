import {
  compartmentResourcePathnameTemplate,
  resourceDeleteRequestSchema,
  resourceDeleteResponseSchema,
  type ResourceDeleteRequest,
  type ResourceDeleteResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import '../../http/request.types';
import { parseRequestValue } from '../../http/validation';
import { deleteResourceForPrincipal } from '../../services/resources.service';
import { createCurrentOrganizationRouteOptions } from '../protected/current-organization-route';
import { buildResourceDeleteResponse } from './resource.presenter';
import { parseResourceTargetQuery } from './resource-get.route';

export function registerDeleteResourceRoute(app: ApiApp): void {
  app.delete(
    compartmentResourcePathnameTemplate,
    createCurrentOrganizationRouteOptions('project.delete'),
    handleDeleteResourceRequest,
  );
}

async function handleDeleteResourceRequest(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const body: ResourceDeleteRequest = parseRequestValue(
    resourceDeleteRequestSchema,
    request.body ?? {},
    'invalid_resource_delete_request',
  );
  const response: ResourceDeleteResponse = resourceDeleteResponseSchema.parse(
    buildResourceDeleteResponse(
      await deleteResourceForPrincipal({
        actorPrincipalId: request.actor.principalId,
        body,
        organizationSlug: request.currentOrganization.slug,
        query: parseResourceTargetQuery(request),
      }),
    ),
  );

  return await reply.send(response);
}
