import { index, pgTable, primaryKey, text, timestamp, type PgTableExtraConfig } from 'drizzle-orm/pg-core';
import type * as UsageMeteringSchemaTypes from './schema-usage-metering.types';

export const edgeTrafficUsageReceipts: UsageMeteringSchemaTypes.EdgeTrafficUsageReceiptsTable = pgTable(
  'edge_traffic_usage_receipts',
  {
    sourceId: text('source_id').notNull(),
    batchId: text('batch_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: UsageMeteringSchemaTypes.EdgeTrafficUsageReceiptsExtraConfigColumns): PgTableExtraConfig => ({
    primaryKey: primaryKey({ columns: [table.sourceId, table.batchId] }),
    retentionIndex: index('edge_traffic_usage_receipts_created_at_idx').on(table.createdAt),
  }),
);
