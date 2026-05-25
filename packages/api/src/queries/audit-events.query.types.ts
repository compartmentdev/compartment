import type {
  AuditEventActorType,
  AuditEventMetadata,
  AuditEventScopeType,
  AuditEventStatus,
  AuditEventType,
  AuditRetentionMode,
  ListPagination,
} from '@compartment/contracts';
import type { Database } from '../db/client';
import type { ApiDatabaseTransaction } from '../db/client.types';

export type AuditEventWriteExecutor = Database | ApiDatabaseTransaction;

export interface AuditEventRow {
  actorEmail: string | null;
  actorPrincipalId: string | null;
  actorType: AuditEventActorType;
  authSessionId: string | null;
  authTransport: string | null;
  environmentId: string | null;
  eventType: AuditEventType;
  id: string;
  metadata: AuditEventMetadata;
  occurredAt: Date;
  organizationId: string | null;
  projectId: string | null;
  projectServiceId: string | null;
  scopeType: AuditEventScopeType;
  sourceIp: string | null;
  status: AuditEventStatus;
  targetDisplayName: string | null;
  targetId: string;
  targetType: string;
  userAgent: string | null;
}

export interface AuditEventPage {
  events: AuditEventRow[];
  pagination: ListPagination;
}

export interface AuditEventExportPage {
  events: AuditEventRow[];
  hasMore: boolean;
}

export interface AuditEventFilterInput {
  actor?: string | undefined;
  eventType?: AuditEventType | undefined;
  from?: Date | undefined;
  organizationId: string;
  project?: string | undefined;
  targetType?: string | undefined;
  to?: Date | undefined;
}

export interface ListAuditEventsPageInput extends AuditEventFilterInput {
  page: number;
  perPage: number;
}

export interface InsertAuditEventInput {
  actorEmail?: string | null | undefined;
  actorPrincipalId?: string | null | undefined;
  actorType: AuditEventActorType;
  authSessionId?: string | null | undefined;
  authTransport?: string | null | undefined;
  environmentId?: string | null | undefined;
  eventType: AuditEventType;
  metadata: AuditEventMetadata;
  occurredAt?: Date | undefined;
  organizationId?: string | null | undefined;
  projectId?: string | null | undefined;
  projectServiceId?: string | null | undefined;
  scopeType: AuditEventScopeType;
  sourceIp?: string | null | undefined;
  status: AuditEventStatus;
  targetDisplayName?: string | null | undefined;
  targetId: string;
  targetType: string;
  userAgent?: string | null | undefined;
}

export interface AuditRetentionCleanupCandidateRow {
  auditRetentionDays: number | null;
  auditRetentionMode: AuditRetentionMode;
  organizationId: string;
}

export interface DeleteExpiredAuditEventsBatchInput {
  limit: number;
  occurredBefore: Date;
  organizationId: string;
}
