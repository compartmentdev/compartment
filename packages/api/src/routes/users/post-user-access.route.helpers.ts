import { organizationUserResponseSchema, type OrganizationUserResponse } from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import '../../http/request.types';
import { parseRequestValue } from '../../http/validation';
import { buildOrganizationUserAuditMetadata } from '../../services/audit-event-metadata.service';
import { recordAuditEvent } from '../../services/audit-events.service';
import type {
  OrganizationUserAccessMutationInput,
  OrganizationUserResult,
} from '../../services/organization-users.service.types';
import { buildAuditEventForRequest } from '../audit/audit-event-route-context';
import type { RouteAuditEventInput } from '../audit/audit-event-route-context.types';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { buildOrganizationUserResponse } from './user.presenter';
import {
  userRouteParamsSchema,
  type OrganizationUserAccessAuditEventType,
  type UserRouteParams,
} from './user.route.types';

type OrganizationUserAccessMutation = (input: OrganizationUserAccessMutationInput) => Promise<OrganizationUserResult>;

interface RegisterPostUserAccessRouteInput {
  auditEventType: OrganizationUserAccessAuditEventType;
  app: ApiApp;
  mutation: OrganizationUserAccessMutation;
  pathname: string;
}

export function registerPostUserAccessRoute(input: RegisterPostUserAccessRouteInput): void {
  input.app.post(
    input.pathname,
    createCurrentOrganizationRouteResponseOptions('organization.user.block', { 200: organizationUserResponseSchema }),
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      await handlePostUserAccess(request, reply, input),
  );
}

async function handlePostUserAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  input: RegisterPostUserAccessRouteInput,
): Promise<FastifyReply> {
  const params: UserRouteParams = parseRequestValue(userRouteParamsSchema, request.params, 'invalid_user_params');
  const user: OrganizationUserResult = await input.mutation({
    actorPrincipalId: request.actor.principalId,
    email: params.email,
    organizationId: request.currentOrganization.id,
    organizationSlug: request.currentOrganization.slug,
  });
  const response: OrganizationUserResponse = organizationUserResponseSchema.parse(buildOrganizationUserResponse(user));
  await recordAuditEvent(buildAuditEventForRequest(request, buildPostUserAccessAuditEventInput(input, response)));

  return await reply.send(response);
}

function buildPostUserAccessAuditEventInput(
  input: RegisterPostUserAccessRouteInput,
  response: OrganizationUserResponse,
): RouteAuditEventInput {
  return {
    eventType: input.auditEventType,
    metadata: buildOrganizationUserAuditMetadata({ email: response.user.email }),
    target: {
      displayName: response.user.email,
      id: response.user.id,
      type: 'user',
    },
  };
}
