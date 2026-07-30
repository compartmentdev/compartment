import type {
  DefaultTimestampBuilder,
  PgExtraConfigColumnsOf,
  PgTableOf,
  RequiredTextBuilder,
} from './schema.shared.types';

interface EdgeTrafficUsageReceiptsColumnBuilders {
  sourceId: RequiredTextBuilder<'source_id'>;
  batchId: RequiredTextBuilder<'batch_id'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
}

export type EdgeTrafficUsageReceiptsTable = PgTableOf<
  'edge_traffic_usage_receipts',
  EdgeTrafficUsageReceiptsColumnBuilders
>;
export type EdgeTrafficUsageReceiptsExtraConfigColumns = PgExtraConfigColumnsOf<
  'edge_traffic_usage_receipts',
  EdgeTrafficUsageReceiptsColumnBuilders
>;
