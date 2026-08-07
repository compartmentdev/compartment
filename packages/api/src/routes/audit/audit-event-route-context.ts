import { readHeaderValue } from '@compartment/utils';
import type { FastifyRequest } from 'fastify';
import '../../http/request.types';
import type {
  AuditEventActorInput,
  RecordInstallationAuditEventInput,
  RecordOrganizationAuditEventInput,
} from '../../services/audit-events.service.types';
import type { RouteAuditEventInput } from './audit-event-route-context.types';

export function buildAuditEventForRequest(
  request: FastifyRequest,
  input: RouteAuditEventInput,
): RecordOrganizationAuditEventInput {
  return {
    ...input,
    actor: buildAuditEventActorForRequest(request),
    organizationId: request.currentOrganization.id,
  };
}

/**
 * Use for actions that span organizations and therefore have no current
 * organization context, such as creating one.
 */
export function buildInstallationAuditEventForRequest(
  request: FastifyRequest,
  input: RouteAuditEventInput,
): RecordInstallationAuditEventInput {
  return {
    ...input,
    actor: buildAuditEventActorForRequest(request),
    scopeType: 'installation',
  };
}

function buildAuditEventActorForRequest(request: FastifyRequest): AuditEventActorInput {
  return {
    email: request.actor.principalEmail,
    principalId: request.actor.principalId,
    sessionId: request.actor.sessionId,
    sourceIp: request.ip,
    transport: request.authTransport,
    type: request.actor.principalType,
    userAgent: readHeaderValue(request.headers['user-agent']) ?? null,
  };
}
