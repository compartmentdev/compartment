import {
  compartmentResourceRestorePathnameTemplate,
  resourceRestoreRequestSchema,
  resourceRestoreResponseSchema,
  type ResourceRestoreRequest,
  type ResourceRestoreResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import '../../http/request.types';
import { parseRequestValue } from '../../http/validation';
import { restoreResourceBackupForPrincipal } from '../../services/resource-backups.service';
import { createCurrentOrganizationRouteOptions } from '../protected/current-organization-route';
import { recordResourceBackupRestoredAuditEvent } from '../audit/privileged-operation-audit';
import { buildResourceRestoreResponse } from './resource.presenter';
import { parseResourceTargetQuery } from './resource-get.route';

export function registerPostResourceRestoreRoute(app: ApiApp): void {
  app.post(
    compartmentResourceRestorePathnameTemplate,
    createCurrentOrganizationRouteOptions('deployment.create', 'resource.backup.restored'),
    handlePostResourceRestoreRequest,
  );
}

async function handlePostResourceRestoreRequest(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const body: ResourceRestoreRequest = parseRequestValue(
    resourceRestoreRequestSchema,
    request.body ?? {},
    'invalid_resource_restore_request',
  );
  const response: ResourceRestoreResponse = resourceRestoreResponseSchema.parse(
    buildResourceRestoreResponse(
      await restoreResourceBackupForPrincipal({
        actorPrincipalId: request.actor.principalId,
        body,
        organizationSlug: request.currentOrganization.slug,
        query: parseResourceTargetQuery(request),
      }),
    ),
  );
  await recordResourceBackupRestoredAuditEvent(request, response);

  return await reply.send(response);
}
