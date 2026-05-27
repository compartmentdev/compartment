import type {
  AuditEventListQuery,
  AuditEventListResponse,
  AuditEventExportQuery,
  AuditEventListOrderBy,
  AuditEventMetadata,
  AuditEventStatus,
  AuditEventSummary,
  AuditEventType,
  ListSortDirection,
} from '@compartment/contracts';
import type { AuditEventWriteExecutor } from '../queries/audit-events.query.types';

export interface AuditEventTargetInput {
  displayName?: string | null | undefined;
  environmentId?: string | null | undefined;
  id: string;
  projectId?: string | null | undefined;
  serviceId?: string | null | undefined;
  type: string;
}

export interface AuditEventActorInput {
  email?: string | null | undefined;
  principalId?: string | null | undefined;
  sessionId?: string | null | undefined;
  sourceIp?: string | null | undefined;
  transport?: string | null | undefined;
  type: 'automation' | 'system' | 'user';
  userAgent?: string | null | undefined;
}

export interface RecordAuditEventInput {
  actor: AuditEventActorInput;
  eventType: AuditEventType;
  executor?: AuditEventWriteExecutor | undefined;
  metadata: AuditEventMetadata;
  organizationId: string;
  status?: AuditEventStatus | undefined;
  target: AuditEventTargetInput;
}

export interface ListOrganizationAuditEventsInput extends AuditEventListQuery {
  organizationId: string;
}

export interface ExportOrganizationAuditEventsInput extends AuditEventExportQuery {
  organizationId: string;
}

export interface OrganizationAuditEventsExportContent {
  content: string;
  rowCount: number;
}

export interface OrganizationAuditEventFilterInput {
  actor?: string | undefined;
  eventType?: AuditEventType | undefined;
  from?: string | undefined;
  organizationId: string;
  orderBy?: AuditEventListOrderBy | undefined;
  project?: string | undefined;
  sort?: ListSortDirection | undefined;
  targetType?: string | undefined;
  to?: string | undefined;
}

export type AuditEventListResult = AuditEventListResponse;
export type AuditEventResult = AuditEventSummary;
