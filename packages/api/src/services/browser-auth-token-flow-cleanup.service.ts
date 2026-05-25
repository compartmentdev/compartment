import { deleteStaleBrowserAuthTokenFlowsBatch } from '../queries/browser-auth-token-flow.query';
import type { BrowserAuthTokenFlowCleanupResult } from './browser-auth-token-flow-cleanup.service.types';

const browserAuthTokenFlowCleanupBatchSize: number = 1000;
const browserAuthTokenFlowCleanupMaxBatches: number = 10;

export async function runBrowserAuthTokenFlowCleanup(): Promise<BrowserAuthTokenFlowCleanupResult> {
  const now: Date = new Date();
  let deletedCount: number = 0;
  let batchCount: number = 0;
  let lastBatchDeletedCount: number = browserAuthTokenFlowCleanupBatchSize;

  while (
    lastBatchDeletedCount === browserAuthTokenFlowCleanupBatchSize &&
    batchCount < browserAuthTokenFlowCleanupMaxBatches
  ) {
    lastBatchDeletedCount = await deleteStaleBrowserAuthTokenFlowsBatch({
      limit: browserAuthTokenFlowCleanupBatchSize,
      now,
    });
    deletedCount += lastBatchDeletedCount;
    batchCount += 1;
  }

  return { deletedCount };
}
