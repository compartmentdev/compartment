import { index, integer, pgTable, text, timestamp, type PgTableExtraConfig } from 'drizzle-orm/pg-core';
import { organizations, principals } from './schema-core';
import { environments, projects, projectServices } from './schema-platform';
import type * as DeploySchemaTypes from './schema-deploy.types';

export const sourceUploads: DeploySchemaTypes.SourceUploadsTable = pgTable(
  'source_uploads',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references((): typeof organizations.id => organizations.id, { onDelete: 'cascade' }),
    createdByPrincipalId: text('created_by_principal_id').references((): typeof principals.id => principals.id, {
      onDelete: 'set null',
    }),
    projectId: text('project_id').references((): typeof projects.id => projects.id, { onDelete: 'cascade' }),
    environmentId: text('environment_id').references((): typeof environments.id => environments.id, {
      onDelete: 'cascade',
    }),
    projectServiceId: text('project_service_id').references((): typeof projectServices.id => projectServices.id, {
      onDelete: 'cascade',
    }),
    sourceDigest: text('source_digest').notNull(),
    byteSize: integer('byte_size').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (table: DeploySchemaTypes.SourceUploadsExtraConfigColumns): PgTableExtraConfig => ({
    consumedAtExpiresAtIndex: index('source_uploads_consumed_at_expires_at_idx').on(table.consumedAt, table.expiresAt),
    scopeIndex: index('source_uploads_scope_idx').on(
      table.organizationId,
      table.projectId,
      table.environmentId,
      table.projectServiceId,
    ),
  }),
);
