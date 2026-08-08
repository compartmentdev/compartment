import type { AuditEventRecordBase } from '../../services/audit-events.service.types';

export type RouteAuditEventInput = Omit<AuditEventRecordBase, 'actor' | 'executor'>;
