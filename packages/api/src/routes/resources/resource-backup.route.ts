import {
  resourceBackupCreateResponseSchema,
  resourceBackupListResponseSchema,
  resourceBackupShowResponseSchema,
  compartmentResourceBackupCollectionPathnameTemplate,
  compartmentResourceBackupRestorePathnameTemplate,
  compartmentResourceBackupShowPathnameTemplate,
  resourceRestoreAsRequestSchema,
  resourceRestoreAsResponseSchema,
  type ResourceBackupCreateResponse,
  type ResourceBackupListResponse,
  type ResourceBackupShowResponse,
  type ResourceRestoreAsRequest,
  type ResourceRestoreAsResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z, type ZodType } from 'zod';
import type { ApiApp } from '../../app.types';
import '../../http/request.types';
import { parseRequestValue } from '../../http/validation';
import {
  createResourceBackupForPrincipal,
  listResourceBackupsForPrincipal,
  showResourceBackupForPrincipal,
} from '../../services/resource-backups.service';
import { restoreResourceBackupAsForPrincipal } from '../../services/resource-backups.restore-as.service';
import { createCurrentOrganizationRouteOptions } from '../protected/current-organization-route';
import {
  buildResourceBackupCreateResponse,
  buildResourceBackupListResponse,
  buildResourceBackupShowResponse,
  buildResourceRestoreAsResponse,
} from './resource.presenter';
import { parseResourceTargetQuery } from './resource-get.route';
import {
  resourceBackupShowRouteQuerySchema,
  resourceListRouteQuerySchema,
  type ResourceBackupShowQuery,
  type ResourceListQuery,
} from './resource.route.types';

interface ResourceBackupRouteParams {
  backupId: string;
}

const resourceBackupRouteParamsSchema: ZodType<ResourceBackupRouteParams> = z
  .object({
    backupId: z.string().min(1),
  })
  .strict();

export function registerResourceBackupRoutes(app: ApiApp): void {
  app.post(
    compartmentResourceBackupCollectionPathnameTemplate,
    createCurrentOrganizationRouteOptions('deployment.create'),
    handlePostResourceBackupRequest,
  );
  app.get(
    compartmentResourceBackupCollectionPathnameTemplate,
    createCurrentOrganizationRouteOptions('deployment.create'),
    handleGetResourceBackupListRequest,
  );
  app.get(
    compartmentResourceBackupShowPathnameTemplate,
    createCurrentOrganizationRouteOptions('deployment.create'),
    handleGetResourceBackupRequest,
  );
  app.post(
    compartmentResourceBackupRestorePathnameTemplate,
    createCurrentOrganizationRouteOptions('deployment.create'),
    handlePostResourceBackupRestoreRequest,
  );
}

async function handlePostResourceBackupRequest(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const response: ResourceBackupCreateResponse = resourceBackupCreateResponseSchema.parse(
    buildResourceBackupCreateResponse(
      await createResourceBackupForPrincipal({
        actorPrincipalId: request.actor.principalId,
        organizationSlug: request.currentOrganization.slug,
        query: parseResourceTargetQuery(request),
      }),
    ),
  );

  return await reply.send(response);
}

async function handleGetResourceBackupListRequest(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const response: ResourceBackupListResponse = resourceBackupListResponseSchema.parse(
    buildResourceBackupListResponse(
      await listResourceBackupsForPrincipal({
        actorPrincipalId: request.actor.principalId,
        organizationSlug: request.currentOrganization.slug,
        query: parseResourceTargetQuery(request),
      }),
    ),
  );

  return await reply.send(response);
}

async function handleGetResourceBackupRequest(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const response: ResourceBackupShowResponse = resourceBackupShowResponseSchema.parse(
    buildResourceBackupShowResponse(
      await showResourceBackupForPrincipal({
        actorPrincipalId: request.actor.principalId,
        organizationSlug: request.currentOrganization.slug,
        query: parseResourceBackupShowQuery(request),
      }),
    ),
  );

  return await reply.send(response);
}

async function handlePostResourceBackupRestoreRequest(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const body: ResourceRestoreAsRequest = parseRequestValue(
    resourceRestoreAsRequestSchema,
    request.body ?? {},
    'invalid_resource_restore_request',
  );
  const response: ResourceRestoreAsResponse = resourceRestoreAsResponseSchema.parse(
    buildResourceRestoreAsResponse(
      await restoreResourceBackupAsForPrincipal({
        actorPrincipalId: request.actor.principalId,
        body,
        organizationSlug: request.currentOrganization.slug,
        query: parseResourceBackupShowQuery(request),
      }),
    ),
  );

  return await reply.send(response);
}

function parseResourceBackupShowQuery(request: FastifyRequest): ResourceBackupShowQuery {
  const params: ResourceBackupRouteParams = parseRequestValue(
    resourceBackupRouteParamsSchema,
    request.params,
    'invalid_resource_backup_params',
  );
  const query: ResourceListQuery = parseRequestValue(
    resourceListRouteQuerySchema,
    request.query,
    'invalid_resource_backup_query',
  );

  return resourceBackupShowRouteQuerySchema.parse({
    ...query,
    backupId: params.backupId,
  });
}
