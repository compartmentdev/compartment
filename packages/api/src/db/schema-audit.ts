import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, type PgTableExtraConfig } from 'drizzle-orm/pg-core';
import { authSessions, organizations, principals } from './schema-core';
import { environments, projects, projectServices } from './schema-platform';
import type { OptionalTextBuilder } from './schema.shared.types';
import type * as AuditSchemaTypes from './schema-audit.types';

export const auditEvents: AuditSchemaTypes.AuditEventsTable = pgTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    scopeType: text('scope_type', { enum: ['organization', 'installation'] }).notNull(),
    organizationId: text('organization_id').references((): typeof organizations.id => organizations.id, {
      onDelete: 'cascade',
    }),
    eventType: text('event_type').notNull(),
    status: text('status', { enum: ['succeeded', 'failed'] }).notNull(),
    actorType: text('actor_type', { enum: ['user', 'automation', 'system'] }).notNull(),
    actorPrincipalId: text('actor_principal_id').references((): typeof principals.id => principals.id, {
      onDelete: 'set null',
    }),
    actorEmail: text('actor_email'),
    authSessionId: text('auth_session_id').references((): typeof authSessions.id => authSessions.id, {
      onDelete: 'set null',
    }),
    authTransport: text('auth_transport'),
    sourceIp: text('source_ip'),
    userAgent: text('user_agent'),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    targetDisplayName: text('target_display_name'),
    projectId: buildAuditEventProjectIdColumn(),
    environmentId: buildAuditEventEnvironmentIdColumn(),
    projectServiceId: buildAuditEventProjectServiceIdColumn(),
    metadataJson: text('metadata_json').default('{}').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  buildAuditEventsExtraConfig,
);

function buildAuditEventProjectIdColumn(): OptionalTextBuilder<'project_id'> {
  return text('project_id').references((): typeof projects.id => projects.id, { onDelete: 'set null' });
}

function buildAuditEventEnvironmentIdColumn(): OptionalTextBuilder<'environment_id'> {
  return text('environment_id').references((): typeof environments.id => environments.id, { onDelete: 'set null' });
}

function buildAuditEventProjectServiceIdColumn(): OptionalTextBuilder<'project_service_id'> {
  return text('project_service_id').references((): typeof projectServices.id => projectServices.id, {
    onDelete: 'set null',
  });
}

function buildAuditEventsExtraConfig(table: AuditSchemaTypes.AuditEventsExtraConfigColumns): PgTableExtraConfig {
  return {
    ...buildAuditEventsLookupIndexes(table),
    ...buildAuditEventsScopeConfig(table),
  };
}

function buildAuditEventsLookupIndexes(table: AuditSchemaTypes.AuditEventsExtraConfigColumns): PgTableExtraConfig {
  return {
    ...buildAuditEventsActorIndexes(table),
    ...buildAuditEventsTargetIndexes(table),
  };
}

function buildAuditEventsActorIndexes(table: AuditSchemaTypes.AuditEventsExtraConfigColumns): PgTableExtraConfig {
  return {
    actorOccurredAtIndex: index('audit_events_actor_occurred_at_idx').on(
      table.organizationId,
      table.actorPrincipalId,
      table.occurredAt,
    ),
    eventTypeOccurredAtIndex: index('audit_events_event_type_occurred_at_idx').on(
      table.organizationId,
      table.eventType,
      table.occurredAt,
    ),
    organizationOccurredAtIndex: index('audit_events_organization_occurred_at_idx').on(
      table.organizationId,
      table.occurredAt,
      table.id,
    ),
  };
}

function buildAuditEventsTargetIndexes(table: AuditSchemaTypes.AuditEventsExtraConfigColumns): PgTableExtraConfig {
  return {
    projectOccurredAtIndex: index('audit_events_project_occurred_at_idx').on(
      table.organizationId,
      table.projectId,
      table.occurredAt,
    ),
    targetTypeOccurredAtIndex: index('audit_events_target_type_occurred_at_idx').on(
      table.organizationId,
      table.targetType,
      table.occurredAt,
    ),
  };
}

function buildAuditEventsScopeConfig(table: AuditSchemaTypes.AuditEventsExtraConfigColumns): PgTableExtraConfig {
  return {
    scopeOccurredAtIndex: index('audit_events_scope_occurred_at_idx').on(table.scopeType, table.occurredAt, table.id),
    scopeOrganizationCheck: check(
      'audit_events_scope_organization_check',
      sql`(${table.scopeType} = 'organization' AND ${table.organizationId} IS NOT NULL) OR (${table.scopeType} = 'installation' AND ${table.organizationId} IS NULL)`,
    ),
  };
}
