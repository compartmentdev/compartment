import {
  inviteUserRequestSchema,
  inviteUserResponseSchema,
  type InviteUserRequest,
  type InviteUserResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import '../../http/request.types';
import { parseRequestValue } from '../../http/validation';
import { buildOrganizationUserAuditMetadata } from '../../services/audit-event-metadata.service';
import { recordAuditEvent } from '../../services/audit-events.service';
import { inviteUserToOrganization } from '../../services/organization-users-invitation.service';
import { buildAuditEventForRequest } from '../audit/audit-event-route-context';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { buildInviteUserResponse } from './user.presenter';
import { usersApiPathname } from './users-api-paths';

export function registerPostInviteUserRoute(app: ApiApp): void {
  app.post(
    usersApiPathname,
    createCurrentOrganizationRouteResponseOptions('organization.user.invite', { 200: inviteUserResponseSchema }),
    handlePostInviteUser,
  );
}

async function handlePostInviteUser(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const input: InviteUserRequest = parseRequestValue(inviteUserRequestSchema, request.body, 'invalid_invite_user');
  const response: InviteUserResponse = inviteUserResponseSchema.parse(
    buildInviteUserResponse(
      await inviteUserToOrganization({
        actorPrincipalId: request.actor.principalId,
        email: input.email,
        organizationId: request.currentOrganization.id,
        organizationSlug: request.currentOrganization.slug,
      }),
    ),
  );
  await recordAuditEvent(
    buildAuditEventForRequest(request, {
      eventType: 'organization.user.invited',
      metadata: buildOrganizationUserAuditMetadata({ email: response.user.email }),
      target: {
        displayName: response.user.email,
        id: response.user.id,
        type: 'user',
      },
    }),
  );

  return await reply.send(response);
}
