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
import { buildResourceDeleteResponse, buildResourceResponse } from './resource.presenter';
import { parseResourceTargetQuery } from './resource-get.route';
import type { ResourceDeleteResult } from '../../services/resources.service.types';
import { recordResourceDeletedAuditEvent } from '../audit/privileged-operation-audit';

export function registerDeleteResourceRoute(app: ApiApp): void {
  app.delete(
    compartmentResourcePathnameTemplate,
    createCurrentOrganizationRouteOptions('project.delete', 'resource.deleted'),
    handleDeleteResourceRequest,
  );
}

async function handleDeleteResourceRequest(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const body: ResourceDeleteRequest = parseRequestValue(
    resourceDeleteRequestSchema,
    request.body ?? {},
    'invalid_resource_delete_request',
  );
  const result: ResourceDeleteResult = await deleteResourceForPrincipal({
    actorPrincipalId: request.actor.principalId,
    body,
    organizationSlug: request.currentOrganization.slug,
    query: parseResourceTargetQuery(request),
  });
  const response: ResourceDeleteResponse = resourceDeleteResponseSchema.parse(
    buildResourceDeleteResponse(result.retainedVolumes),
  );
  await recordResourceDeletedAuditEvent(request, buildResourceResponse(result), body.deleteData === true);

  return await reply.send(response);
}
