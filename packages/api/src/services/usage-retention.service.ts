import type { ApiConfig } from '../config';
import { deleteExpiredUsageBatch } from '../queries/usage-metering.query';
import { getApiConfig } from '../runtime/runtime-access';
import type { UsageRetentionCleanupResult } from './usage-retention.service.types';

const dayMs: number = 24 * 60 * 60 * 1000;

export async function runUsageRetentionCleanup(): Promise<UsageRetentionCleanupResult> {
  const config: ApiConfig = getApiConfig();
  const usageBefore: Date = new Date(Date.now() - config.usageRetentionDays * dayMs);
  let deletedCount: number = 0;
  for (let batch: number = 0; batch < config.auditRetentionCleanupMaxBatches; batch += 1) {
    const batchDeleted: number = await deleteExpiredUsageBatch({
      before: usageBefore,
      limit: config.auditRetentionCleanupBatchSize,
    });
    deletedCount += batchDeleted;
    if (batchDeleted < config.auditRetentionCleanupBatchSize) {
      break;
    }
  }
  return { deletedCount };
}
