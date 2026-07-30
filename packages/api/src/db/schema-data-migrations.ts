import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { DataMigrationMarkersTable } from './schema-data-migrations.types';

export const dataMigrationMarkers: DataMigrationMarkersTable = pgTable('data_migration_markers', {
  id: text('id').primaryKey(),
  completedAt: timestamp('completed_at', { withTimezone: true }).defaultNow().notNull(),
});
