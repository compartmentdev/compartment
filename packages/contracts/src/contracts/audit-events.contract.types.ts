import type { ListPagination, ListSortDirection } from './list.contract';

export type AuditEventScopeType = 'installation' | 'organization';
export type AuditEventStatus = 'failed' | 'succeeded';
export type AuditEventActorType = 'automation' | 'system' | 'user';
export type AuditEventExportFormat = 'csv' | 'ndjson';
export type AuditEventMetadataValue = boolean | number | string | null;
export type AuditEventMetadata = Record<string, AuditEventMetadataValue>;
export type AuditEventListOrderBy = 'eventType' | 'occurredAt' | 'status';
export type AuditEventType =
  | 'audit.export.created'
  | 'authentication.account_claimed'
  | 'authentication.login'
  | 'authorization.denied'
  | 'deployment.created'
  | 'deployment.kubernetes.drift_detected'
  | 'deployment.rolled_back'
  | 'installation.organization.created'
  | 'installation.owner.activated'
  | 'organization.assignment.created'
  | 'organization.assignment.deleted'
  | 'organization.auth_settings.updated'
  | 'organization.group.created'
  | 'organization.group.deleted'
  | 'organization.group.member_added'
  | 'organization.group.member_removed'
  | 'organization.group.updated'
  | 'organization.role.created'
  | 'organization.role.deleted'
  | 'organization.role.updated'
  | 'organization.settings.updated'
  | 'organization.sso_oidc_provider.created'
  | 'organization.sso_oidc_provider.deleted'
  | 'organization.sso_oidc_provider.updated'
  | 'organization.user.blocked'
  | 'organization.user.invited'
  | 'organization.user.password_reset_issued'
  | 'organization.user.removed'
  | 'organization.user.unblocked'
  | 'resource.backup.created'
  | 'resource.backup.restored'
  | 'resource.bootstrapped'
  | 'resource.deleted'
  | 'resource.started'
  | 'resource.stopped'
  | 'service.access_mode.changed'
  | 'source.auto_deploy.queued'
  | 'source.auto_deploy.skipped'
  | 'source.binding.created'
  | 'source.connected'
  | 'source.descriptor.excluded'
  | 'source.descriptor.included'
  | 'source.disconnected'
  | 'source.upload.created'
  | 'source.push.received'
  | 'source.settings.updated'
  | 'source.sync.failed'
  | 'source.sync.requested'
  | 'source.sync.succeeded'
  | 'variable.changed';

export interface AuditEventActorSummary {
  email: string | null;
  principalId: string | null;
  sessionId: string | null;
  sourceIp: string | null;
  transport: string | null;
  type: AuditEventActorType;
  userAgent: string | null;
}

export interface AuditEventTargetSummary {
  displayName: string | null;
  environmentId: string | null;
  id: string;
  projectId: string | null;
  serviceId: string | null;
  type: string;
}

export interface AuditEventSummary {
  actor: AuditEventActorSummary;
  eventType: AuditEventType;
  id: string;
  metadata: AuditEventMetadata;
  occurredAt: string;
  organizationId: string | null;
  scopeType: AuditEventScopeType;
  status: AuditEventStatus;
  target: AuditEventTargetSummary;
}

export interface AuditEventListQuery {
  actor?: string | undefined;
  eventType?: AuditEventType | undefined;
  from?: string | undefined;
  orderBy?: AuditEventListOrderBy | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  project?: string | undefined;
  sort?: ListSortDirection | undefined;
  targetType?: string | undefined;
  to?: string | undefined;
}

export interface AuditEventExportQuery extends Omit<AuditEventListQuery, 'page' | 'perPage'> {
  format: AuditEventExportFormat;
}

export interface AuditEventListResponse {
  events: AuditEventSummary[];
  pagination: ListPagination;
}

export interface AuditEventListQueryInput {
  actor?: string | undefined;
  eventType?: AuditEventType | undefined;
  from?: string | undefined;
  orderBy?: AuditEventListOrderBy | undefined;
  page?: number | string | undefined;
  perPage?: number | string | undefined;
  project?: string | undefined;
  sort?: ListSortDirection | undefined;
  targetType?: string | undefined;
  to?: string | undefined;
}

export interface AuditEventExportQueryInput extends Omit<AuditEventListQueryInput, 'page' | 'perPage'> {
  format?: AuditEventExportFormat | undefined;
}
