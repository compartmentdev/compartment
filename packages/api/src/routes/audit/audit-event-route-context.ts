import { readHeaderValue } from '@compartment/utils';
import type { FastifyRequest } from 'fastify';
import '../../http/request.types';
import type { RecordAuditEventInput } from '../../services/audit-events.service.types';
import type { RouteAuditEventInput } from './audit-event-route-context.types';

export function buildAuditEventForRequest(request: FastifyRequest, input: RouteAuditEventInput): RecordAuditEventInput {
  return {
    ...input,
    actor: {
      email: request.actor.principalEmail,
      principalId: request.actor.principalId,
      sessionId: request.actor.sessionId,
      sourceIp: request.ip,
      transport: request.authTransport,
      type: request.actor.principalType,
      userAgent: readHeaderValue(request.headers['user-agent']) ?? null,
    },
    organizationId: request.currentOrganization.id,
  };
}
