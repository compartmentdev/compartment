import {
  compartmentOrganizationSettingsPathname,
  organizationSettingsResponseSchema,
  updateOrganizationSettingsRequestSchema,
  type OrganizationSettingsResponse,
  type UpdateOrganizationSettingsRequest,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import '../../http/request.types';
import { parseRequestValue } from '../../http/validation';
import { buildOrganizationSettingsUpdatedAuditMetadata } from '../../services/audit-event-metadata.service';
import { recordAuditEvent } from '../../services/audit-events.service';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { readOrganizationSettings, updateOrganizationSettings } from '../../services/organization-settings.service';
import type { OrganizationSettingsResult } from '../../services/organization-settings.service.types';
import { buildAuditEventForRequest } from '../audit/audit-event-route-context';
import type { RouteAuditEventInput } from '../audit/audit-event-route-context.types';
import { buildOrganizationSettingsResponse } from './organization-settings.presenter';

export function registerOrganizationSettingsRoutes(app: ApiApp): void {
  registerOrganizationSettingsGetRoute(app);
  registerOrganizationSettingsPatchRoute(app);
}

function registerOrganizationSettingsGetRoute(app: ApiApp): void {
  app.get(
    compartmentOrganizationSettingsPathname,
    createCurrentOrganizationRouteResponseOptions(undefined, {
      200: organizationSettingsResponseSchema,
    }),
    handleOrganizationSettingsGet,
  );
}

function registerOrganizationSettingsPatchRoute(app: ApiApp): void {
  app.patch(
    compartmentOrganizationSettingsPathname,
    createCurrentOrganizationRouteResponseOptions('organization.settings.manage', {
      200: organizationSettingsResponseSchema,
    }),
    handleOrganizationSettingsPatch,
  );
}

async function handleOrganizationSettingsGet(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const settings: OrganizationSettingsResult = await readOrganizationSettings(request.currentOrganization.id);

  return await reply.send(buildOrganizationSettingsRouteResponse(settings));
}

async function handleOrganizationSettingsPatch(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const body: UpdateOrganizationSettingsRequest = parseRequestValue(
    updateOrganizationSettingsRequestSchema,
    request.body,
    'invalid_organization_settings',
  );
  const settings: OrganizationSettingsResult = await updateOrganizationSettings({
    actorPrincipalId: request.actor.principalId,
    auditRetention: body.auditRetention,
    organizationId: request.currentOrganization.id,
    organizationSlug: request.currentOrganization.slug,
    rollbackRetention: body.rollbackRetention,
  });
  await recordAuditEvent(buildAuditEventForRequest(request, buildOrganizationSettingsAuditEventInput(request, body)));

  return await reply.send(buildOrganizationSettingsRouteResponse(settings));
}

function buildOrganizationSettingsAuditEventInput(
  request: FastifyRequest,
  body: UpdateOrganizationSettingsRequest,
): RouteAuditEventInput {
  return {
    eventType: 'organization.settings.updated',
    metadata: buildOrganizationSettingsUpdatedAuditMetadata({
      auditRetentionUpdated: body.auditRetention !== undefined,
      rollbackRetentionUpdated: body.rollbackRetention !== undefined,
    }),
    target: {
      displayName: request.currentOrganization.slug,
      id: request.currentOrganization.id,
      type: 'organization',
    },
  };
}

function buildOrganizationSettingsRouteResponse(settings: OrganizationSettingsResult): OrganizationSettingsResponse {
  return organizationSettingsResponseSchema.parse(buildOrganizationSettingsResponse(settings));
}
