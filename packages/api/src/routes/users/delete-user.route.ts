import { removeUserResponseSchema, type RemoveUserResponse } from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import '../../http/request.types';
import { parseRequestValue } from '../../http/validation';
import { buildOrganizationUserAuditMetadata } from '../../services/audit-event-metadata.service';
import { recordAuditEvent } from '../../services/audit-events.service';
import { removeUserFromOrganization } from '../../services/organization-users.service';
import type { OrganizationUserResult } from '../../services/organization-users.service.types';
import { buildAuditEventForRequest } from '../audit/audit-event-route-context';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { userRouteParamsSchema, type UserRouteParams } from './user.route.types';
import { userApiPathname } from './users-api-paths';

export function registerDeleteUserRoute(app: ApiApp): void {
  app.delete(
    userApiPathname,
    createCurrentOrganizationRouteResponseOptions('organization.user.remove', { 200: removeUserResponseSchema }),
    handleDeleteUser,
  );
}

async function handleDeleteUser(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: UserRouteParams = parseRequestValue(userRouteParamsSchema, request.params, 'invalid_user_params');
  const removedUser: OrganizationUserResult = await removeUserFromOrganization({
    actorPrincipalId: request.actor.principalId,
    email: params.email,
    organizationId: request.currentOrganization.id,
    organizationSlug: request.currentOrganization.slug,
  });
  const response: RemoveUserResponse = removeUserResponseSchema.parse({ success: true });
  await recordAuditEvent(
    buildAuditEventForRequest(request, {
      eventType: 'organization.user.removed',
      metadata: buildOrganizationUserAuditMetadata({ email: removedUser.email }),
      target: {
        displayName: removedUser.email,
        id: removedUser.id,
        type: 'user',
      },
    }),
  );

  return await reply.send(response);
}
