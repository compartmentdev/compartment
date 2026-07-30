import type { DefaultTimestampBuilder, PgTableOf, PrimaryTextBuilder } from './schema.shared.types';

interface DataMigrationMarkersColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  completedAt: DefaultTimestampBuilder<'completed_at'>;
}

export type DataMigrationMarkersTable = PgTableOf<'data_migration_markers', DataMigrationMarkersColumnBuilders>;
