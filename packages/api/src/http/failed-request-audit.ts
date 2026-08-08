import { readHeaderValue } from '@compartment/utils';
import type { AuditEventType } from '@compartment/contracts';
import type { FastifyRequest } from 'fastify';
import { recordAuditEvent } from '../services/audit-events.service';
import type { RecordOrganizationAuditEventInput } from '../services/audit-events.service.types';
import type { Actor } from '../services/auth-actor.types';
import type { CurrentOrganizationAccess } from './request.types';

interface OptionalFailedRequestAuditContext {
  actor?: Actor | undefined;
  authTransport?: 'bearer' | 'browser_cookie' | undefined;
  currentOrganization?: CurrentOrganizationAccess | undefined;
}

interface FailedRequestAuditContext {
  actor: Actor;
  authTransport: 'bearer' | 'browser_cookie';
  currentOrganization: CurrentOrganizationAccess;
}

export async function auditFailedPrivilegedRequest(request: FastifyRequest, errorCode: string): Promise<void> {
  const eventType: AuditEventType | undefined = request.routeOptions.config.failedAuditEventType;
  const context: FailedRequestAuditContext | null = readFailedRequestAuditContext(request);
  if (eventType === undefined || context === null) {
    return;
  }
  try {
    await recordAuditEvent(buildFailedRequestAuditInput(request, context, eventType, errorCode));
  } catch (auditError) {
    request.log.error({ err: auditError }, 'Failed to record privileged request failure audit event.');
  }
}

function buildFailedRequestAuditInput(
  request: FastifyRequest,
  context: FailedRequestAuditContext,
  eventType: AuditEventType,
  errorCode: string,
): RecordOrganizationAuditEventInput {
  const routeUrl: string = request.routeOptions.url ?? request.url;
  return {
    actor: {
      email: context.actor.principalEmail,
      principalId: context.actor.principalId,
      sessionId: context.actor.sessionId,
      sourceIp: request.ip,
      transport: context.authTransport,
      type: context.actor.principalType,
      userAgent: readHeaderValue(request.headers['user-agent']) ?? null,
    },
    eventType,
    metadata: { errorCode, method: request.method },
    organizationId: context.currentOrganization.id,
    status: 'failed',
    target: { displayName: routeUrl, id: routeUrl, type: 'route' },
  };
}

function readFailedRequestAuditContext(request: FastifyRequest): FailedRequestAuditContext | null {
  const context: OptionalFailedRequestAuditContext = request;
  if (context.actor === undefined || context.authTransport === undefined || context.currentOrganization === undefined) {
    return null;
  }
  return {
    actor: context.actor,
    authTransport: context.authTransport,
    currentOrganization: context.currentOrganization,
  };
}
