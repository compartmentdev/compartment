import { deleteExpiredDeploymentProductLogsBatch } from '../queries/deployment-product-logs.query';
import { getApiConfig } from '../runtime/runtime-access';
import type { ApiConfig } from '../config';
import type { ProductLogRetentionCleanupResult } from './product-log-retention.service.types';

const dayMs: number = 24 * 60 * 60 * 1000;

export async function runProductLogRetentionCleanup(): Promise<ProductLogRetentionCleanupResult> {
  const config: ApiConfig = getApiConfig();
  const capturedBefore: Date = new Date(Date.now() - config.auditRetentionDays * dayMs);
  let deletedCount: number = 0;
  for (let batch: number = 0; batch < config.auditRetentionCleanupMaxBatches; batch += 1) {
    const batchDeletedCount: number = await deleteExpiredDeploymentProductLogsBatch({
      capturedBefore,
      limit: config.auditRetentionCleanupBatchSize,
    });
    deletedCount += batchDeletedCount;
    if (batchDeletedCount < config.auditRetentionCleanupBatchSize) {
      break;
    }
  }
  return { deletedCount };
}
