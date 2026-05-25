import type { RecordAuditEventInput } from '../../services/audit-events.service.types';

export type RouteAuditEventInput = Omit<RecordAuditEventInput, 'actor' | 'executor' | 'organizationId'>;
