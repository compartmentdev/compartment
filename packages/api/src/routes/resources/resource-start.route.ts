import {
  compartmentResourceStartPathnameTemplate,
  resourceResponseSchema,
  type ResourceResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import '../../http/request.types';
import { startResourceForPrincipal } from '../../services/resources.service';
import { createCurrentOrganizationRouteOptions } from '../protected/current-organization-route';
import { recordResourceAuditEvent } from '../audit/privileged-operation-audit';
import { buildResourceResponse } from './resource.presenter';
import { parseResourceTargetQuery } from './resource-get.route';

export function registerPostResourceStartRoute(app: ApiApp): void {
  app.post(
    compartmentResourceStartPathnameTemplate,
    createCurrentOrganizationRouteOptions('project.lifecycle.write', 'resource.started'),
    handlePostResourceStartRequest,
  );
}

async function handlePostResourceStartRequest(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const response: ResourceResponse = resourceResponseSchema.parse(
    buildResourceResponse(
      await startResourceForPrincipal({
        actorPrincipalId: request.actor.principalId,
        organizationSlug: request.currentOrganization.slug,
        query: parseResourceTargetQuery(request),
      }),
    ),
  );
  await recordResourceAuditEvent(request, response, 'resource.started');

  return await reply.send(response);
}
