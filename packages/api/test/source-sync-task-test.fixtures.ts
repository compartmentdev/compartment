import { eq } from 'drizzle-orm';
import { sourceSyncTasks } from '../src/db/schema';
import type { SourceWriteExecutor } from '../src/queries/source.query.types';
import { createSourceSyncClaimToken } from '../src/queries/source-sync-claim-token.query.support';

const sourceSyncTestClaimToken: string = 'wrk_sync_test';
const sourceSyncTestClaimedAt: Date = new Date('2999-04-29T10:01:00.000Z');
const sourceSyncTestLeaseExpiresAt: Date = new Date('2999-04-29T10:06:00.000Z');

export async function claimSourceSyncTaskForTest(
  executor: SourceWriteExecutor,
  taskId: string,
  claimTokenSecret: string,
): Promise<string> {
  const task: typeof sourceSyncTasks.$inferSelect = readFirstSourceSyncTask(
    await executor.select().from(sourceSyncTasks).where(eq(sourceSyncTasks.id, taskId)),
    'source sync task to claim',
  );

  if (task.status === 'claimed' && task.claimedByWorkerId !== null) {
    await executor
      .update(sourceSyncTasks)
      .set({
        leaseExpiresAt: sourceSyncTestLeaseExpiresAt,
      })
      .where(eq(sourceSyncTasks.id, taskId));
    return createSourceSyncClaimToken({
      claimedAt: readClaimedAt(task.claimedAt),
      claimedByWorkerId: task.claimedByWorkerId,
      secret: claimTokenSecret,
    });
  }

  await executor
    .update(sourceSyncTasks)
    .set({
      claimedAt: sourceSyncTestClaimedAt,
      claimedByWorkerId: sourceSyncTestClaimToken,
      leaseExpiresAt: sourceSyncTestLeaseExpiresAt,
      status: 'claimed',
    })
    .where(eq(sourceSyncTasks.id, taskId));

  return createSourceSyncClaimToken({
    claimedAt: sourceSyncTestClaimedAt,
    claimedByWorkerId: sourceSyncTestClaimToken,
    secret: claimTokenSecret,
  });
}

function readFirstSourceSyncTask(
  rows: (typeof sourceSyncTasks.$inferSelect)[],
  description: string,
): typeof sourceSyncTasks.$inferSelect {
  const row: typeof sourceSyncTasks.$inferSelect | undefined = rows[0];
  if (row === undefined) {
    throw new Error(`Expected ${description}.`);
  }

  return row;
}

function readClaimedAt(claimedAt: Date | null): Date {
  if (claimedAt === null) {
    throw new Error('Expected claimed source sync task to have claimedAt.');
  }

  return claimedAt;
}
