import {
  compartmentAuthSettingsPathname,
  organizationAuthSettingsResponseSchema,
  updateOrganizationAuthSettingsRequestSchema,
  type OrganizationAuthSettingsResponse,
  type UpdateOrganizationAuthSettingsRequest,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import '../../http/request.types';
import { parseRequestValue } from '../../http/validation';
import { buildOrganizationAuthSettingsUpdatedAuditMetadata } from '../../services/audit-event-metadata.service';
import { recordAuditEvent } from '../../services/audit-events.service';
import {
  readOrganizationAuthSettings,
  updateOrganizationAuthSettings,
} from '../../services/organization-auth-settings.service';
import type { OrganizationAuthSettingsResult } from '../../services/organization-auth-settings.service.types';
import { buildAuditEventForRequest } from '../audit/audit-event-route-context';
import type { RouteAuditEventInput } from '../audit/audit-event-route-context.types';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { buildOrganizationAuthSettingsResponse } from './auth-settings.presenter';

export function registerOrganizationAuthSettingsRoutes(app: ApiApp): void {
  registerOrganizationAuthSettingsGetRoute(app);
  registerOrganizationAuthSettingsPatchRoute(app);
}

function registerOrganizationAuthSettingsGetRoute(app: ApiApp): void {
  app.get(
    compartmentAuthSettingsPathname,
    createCurrentOrganizationRouteResponseOptions('organization.auth.manage', {
      200: organizationAuthSettingsResponseSchema,
    }),
    handleOrganizationAuthSettingsGet,
  );
}

function registerOrganizationAuthSettingsPatchRoute(app: ApiApp): void {
  app.patch(
    compartmentAuthSettingsPathname,
    createCurrentOrganizationRouteResponseOptions('organization.auth.manage', {
      200: organizationAuthSettingsResponseSchema,
    }),
    handleOrganizationAuthSettingsPatch,
  );
}

async function handleOrganizationAuthSettingsGet(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const settings: OrganizationAuthSettingsResult = await readOrganizationAuthSettings(request.currentOrganization.id);

  return await reply.send(buildAuthSettingsRouteResponse(settings));
}

async function handleOrganizationAuthSettingsPatch(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const body: UpdateOrganizationAuthSettingsRequest = parseRequestValue(
    updateOrganizationAuthSettingsRequestSchema,
    request.body,
    'invalid_auth_settings',
  );
  const settings: OrganizationAuthSettingsResult = await updateOrganizationAuthSettings({
    actorPrincipalId: request.actor.principalId,
    localPasswordEnabled: body.localPasswordEnabled,
    organizationId: request.currentOrganization.id,
    organizationSlug: request.currentOrganization.slug,
  });
  await recordAuditEvent(buildAuditEventForRequest(request, buildAuthSettingsAuditEventInput(request, body)));

  return await reply.send(buildAuthSettingsRouteResponse(settings));
}

function buildAuthSettingsAuditEventInput(
  request: FastifyRequest,
  body: UpdateOrganizationAuthSettingsRequest,
): RouteAuditEventInput {
  return {
    eventType: 'organization.auth_settings.updated',
    metadata: buildOrganizationAuthSettingsUpdatedAuditMetadata({
      localPasswordEnabled: body.localPasswordEnabled,
    }),
    target: {
      displayName: request.currentOrganization.slug,
      id: request.currentOrganization.id,
      type: 'organization',
    },
  };
}

function buildAuthSettingsRouteResponse(settings: OrganizationAuthSettingsResult): OrganizationAuthSettingsResponse {
  return organizationAuthSettingsResponseSchema.parse(buildOrganizationAuthSettingsResponse(settings));
}
