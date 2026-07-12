import { and, eq, gte, lte, or, type SQL } from 'drizzle-orm';
import { auditEvents } from '../db/schema';
import type { AuditEventFilterInput } from './audit-events.query.types';
import { buildPrincipalEmailLookup } from './principal-email.query.helpers';

export function buildAuditEventFilter(input: AuditEventFilterInput): SQL {
  const filters: SQL[] = [
    eq(auditEvents.organizationId, input.organizationId),
    eq(auditEvents.scopeType, 'organization'),
  ];
  appendTimeFilters(filters, input);
  appendAttributeFilters(filters, input);
  return and(...filters)!;
}

function appendTimeFilters(filters: SQL[], input: AuditEventFilterInput): void {
  if (input.from !== undefined) {
    filters.push(gte(auditEvents.occurredAt, input.from));
  }
  if (input.to !== undefined) {
    filters.push(lte(auditEvents.occurredAt, input.to));
  }
}

function appendAttributeFilters(filters: SQL[], input: AuditEventFilterInput): void {
  if (input.eventType !== undefined) {
    filters.push(eq(auditEvents.eventType, input.eventType));
  }
  if (input.actor !== undefined) {
    filters.push(
      or(
        eq(auditEvents.actorPrincipalId, input.actor),
        buildPrincipalEmailLookup(input.actor, auditEvents.actorEmail),
      )!,
    );
  }
  if (input.targetType !== undefined) {
    filters.push(eq(auditEvents.targetType, input.targetType));
  }
  if (input.project !== undefined) {
    filters.push(eq(auditEvents.projectId, input.project));
  }
}
