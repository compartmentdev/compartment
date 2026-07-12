import {
  compartmentResourceBootstrapPathnameTemplate,
  resourceResponseSchema,
  type ResourceResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import '../../http/request.types';
import { bootstrapResourceForPrincipal } from '../../services/resources.service';
import { createCurrentOrganizationRouteOptions } from '../protected/current-organization-route';
import { buildResourceResponse } from './resource.presenter';
import { parseResourceTargetQuery } from './resource-get.route';

export function registerPostResourceBootstrapRoute(app: ApiApp): void {
  app.post(
    compartmentResourceBootstrapPathnameTemplate,
    createCurrentOrganizationRouteOptions('project.lifecycle.write'),
    handlePostResourceBootstrapRequest,
  );
}

async function handlePostResourceBootstrapRequest(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const response: ResourceResponse = resourceResponseSchema.parse(
    buildResourceResponse(
      await bootstrapResourceForPrincipal({
        actorPrincipalId: request.actor.principalId,
        organizationSlug: request.currentOrganization.slug,
        query: parseResourceTargetQuery(request),
      }),
    ),
  );
  return await reply.send(response);
}
