import type {
  DefaultTextBuilder,
  DefaultTimestampBuilder,
  OptionalTextBuilder,
  PgExtraConfigColumnsOf,
  PgTableOf,
  PrimaryTextBuilder,
  RequiredTextBuilder,
} from './schema.shared.types';

interface AuditEventsColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  scopeType: RequiredTextBuilder<'scope_type'>;
  organizationId: OptionalTextBuilder<'organization_id'>;
  eventType: RequiredTextBuilder<'event_type'>;
  status: RequiredTextBuilder<'status'>;
  actorType: RequiredTextBuilder<'actor_type'>;
  actorPrincipalId: OptionalTextBuilder<'actor_principal_id'>;
  actorEmail: OptionalTextBuilder<'actor_email'>;
  authSessionId: OptionalTextBuilder<'auth_session_id'>;
  authTransport: OptionalTextBuilder<'auth_transport'>;
  sourceIp: OptionalTextBuilder<'source_ip'>;
  userAgent: OptionalTextBuilder<'user_agent'>;
  targetType: RequiredTextBuilder<'target_type'>;
  targetId: RequiredTextBuilder<'target_id'>;
  targetDisplayName: OptionalTextBuilder<'target_display_name'>;
  projectId: OptionalTextBuilder<'project_id'>;
  environmentId: OptionalTextBuilder<'environment_id'>;
  projectServiceId: OptionalTextBuilder<'project_service_id'>;
  metadataJson: DefaultTextBuilder<'metadata_json'>;
  occurredAt: DefaultTimestampBuilder<'occurred_at'>;
}

export type AuditEventsTable = PgTableOf<'audit_events', AuditEventsColumnBuilders>;
export type AuditEventsExtraConfigColumns = PgExtraConfigColumnsOf<'audit_events', AuditEventsColumnBuilders>;
