import { setTimeout as sleep } from 'node:timers/promises';
import type { PoolClient, QueryResult } from 'pg';
import { getApiDatabase } from '../runtime/runtime-access';
import type {
  ResourceOperationLock,
  ResourceOperationTryLockRow,
  ResourceOperationUnlockRow,
} from './resource-operation-lock.query.types';

const resourceOperationLockNamespace: number = 83_019;
const resourceOperationLockRetryMs: number = 25;

export async function acquireResourceOperationLocks(resourceIds: string[]): Promise<ResourceOperationLock> {
  const canonicalIds: string[] = canonicalResourceIds(resourceIds);
  for (;;) {
    const client: PoolClient = await getApiDatabase().$resourceOperationClientPool.connect();
    const lock: ResourceOperationLock | null = await tryAcquireResourceOperationLocks(client, canonicalIds);
    if (lock !== null) {
      return lock;
    }
    await waitForResourceOperationLockRetry();
  }
}

async function tryAcquireResourceOperationLocks(
  client: PoolClient,
  resourceIds: string[],
): Promise<ResourceOperationLock | null> {
  const acquiredIds: string[] = [];
  try {
    for (const resourceId of resourceIds) {
      if (!(await tryAcquireResourceOperationLock(client, resourceId))) {
        await unlockResourceOperationLocks(client, acquiredIds);
        client.release();
        return null;
      }
      acquiredIds.push(resourceId);
    }
    return new PgResourceOperationLock(client, acquiredIds);
  } catch (error) {
    client.release(error instanceof Error ? error : true);
    throw error;
  }
}

async function tryAcquireResourceOperationLock(client: PoolClient, resourceId: string): Promise<boolean> {
  const result: QueryResult<ResourceOperationTryLockRow> = await client.query<ResourceOperationTryLockRow>(
    'select pg_try_advisory_lock(hashtextextended($1::text, $2::bigint)) as acquired',
    [resourceId, resourceOperationLockNamespace],
  );
  return result.rows[0]?.acquired === true;
}

function canonicalResourceIds(resourceIds: string[]): string[] {
  return [...new Set(resourceIds)].sort((left: string, right: string): number => left.localeCompare(right));
}

async function waitForResourceOperationLockRetry(): Promise<void> {
  await sleep(resourceOperationLockRetryMs);
}

class PgResourceOperationLock implements ResourceOperationLock {
  private released: boolean = false;

  public constructor(
    private readonly client: PoolClient,
    private readonly resourceIds: string[],
  ) {}

  public async release(): Promise<void> {
    if (this.released) {
      return;
    }
    this.released = true;
    try {
      await unlockResourceOperationLocks(this.client, this.resourceIds);
      this.client.release();
    } catch (error) {
      this.client.release(error instanceof Error ? error : true);
      throw error;
    }
  }
}

async function unlockResourceOperationLocks(client: PoolClient, resourceIds: string[]): Promise<void> {
  for (const resourceId of resourceIds.toReversed()) {
    const result: QueryResult<ResourceOperationUnlockRow> = await client.query<ResourceOperationUnlockRow>(
      'select pg_advisory_unlock(hashtextextended($1::text, $2::bigint)) as unlocked',
      [resourceId, resourceOperationLockNamespace],
    );
    if (result.rows[0]?.unlocked !== true) {
      throw new Error(`Resource operation lock ${resourceId} was not held by its database session.`);
    }
  }
}
