import { and, eq, gt, inArray, sql, type SQL } from 'drizzle-orm';
import { getApiDatabase } from '../runtime/runtime-access';
import { throttleBuckets } from '../db/schema';
import type {
  InsertThrottleBucketInput,
  PersistedThrottleBucketRow,
  ThrottleBucketIdentity,
  ThrottleBucketRow,
  ThrottleBucketTimestampValue,
  ThrottleBucketWindowPolicy,
  ThrottleBucketsTransaction,
  UpdateThrottleBucketInput,
} from './throttle.query.types';

export async function findBlockingThrottleBuckets(
  scope: string,
  action: string,
  bucketKeyHashes: readonly string[],
  now: Date,
): Promise<ThrottleBucketRow[]> {
  if (bucketKeyHashes.length === 0) {
    return [];
  }

  return await getApiDatabase()
    .select(throttleBucketSelection)
    .from(throttleBuckets)
    .where(
      and(
        eq(throttleBuckets.scope, scope),
        eq(throttleBuckets.action, action),
        inArray(throttleBuckets.bucketKeyHash, [...bucketKeyHashes]),
        gt(throttleBuckets.blockedUntilAt, now),
      ),
    );
}

export async function findThrottleBucketForUpdateWithExecutor(
  tx: ThrottleBucketsTransaction,
  identity: ThrottleBucketIdentity,
): Promise<ThrottleBucketRow | undefined> {
  const row: PersistedThrottleBucketRow | undefined = await selectThrottleBucketForUpdateWithExecutor(tx, identity);
  if (row === undefined) {
    return undefined;
  }

  return normalizeThrottleBucketRow(row);
}

async function selectThrottleBucketForUpdateWithExecutor(
  tx: ThrottleBucketsTransaction,
  identity: ThrottleBucketIdentity,
): Promise<PersistedThrottleBucketRow | undefined> {
  const rows: object[] = (await tx.execute(buildSelectThrottleBucketForUpdateQuery(identity))).rows;

  return rows[0] as PersistedThrottleBucketRow | undefined;
}

function buildSelectThrottleBucketForUpdateQuery(identity: ThrottleBucketIdentity): SQL<PersistedThrottleBucketRow> {
  return sql<PersistedThrottleBucketRow>`
    select
      ${throttleBuckets.action} as "action",
      ${throttleBuckets.attemptCount} as "attemptCount",
      ${throttleBuckets.blockedUntilAt} as "blockedUntilAt",
      ${throttleBuckets.bucketKeyHash} as "bucketKeyHash",
      ${throttleBuckets.bucketKind} as "bucketKind",
      ${throttleBuckets.createdAt} as "createdAt",
      ${throttleBuckets.scope} as "scope",
      ${throttleBuckets.updatedAt} as "updatedAt",
      ${throttleBuckets.windowStartedAt} as "windowStartedAt"
    from ${throttleBuckets}
    where ${throttleBuckets.scope} = ${identity.scope}
      and ${throttleBuckets.action} = ${identity.action}
      and ${throttleBuckets.bucketKind} = ${identity.bucketKind}
      and ${throttleBuckets.bucketKeyHash} = ${identity.bucketKeyHash}
    for update
  `;
}

export async function tryInsertThrottleBucketWithExecutor(
  tx: ThrottleBucketsTransaction,
  input: InsertThrottleBucketInput,
): Promise<boolean> {
  const rows: { bucketKeyHash: string }[] = await tx
    .insert(throttleBuckets)
    .values({
      action: input.action,
      attemptCount: input.attemptCount,
      blockedUntilAt: input.blockedUntilAt,
      bucketKeyHash: input.bucketKeyHash,
      bucketKind: input.bucketKind,
      createdAt: input.createdAt,
      scope: input.scope,
      updatedAt: input.updatedAt,
      windowStartedAt: input.windowStartedAt,
    })
    .onConflictDoNothing()
    .returning({ bucketKeyHash: throttleBuckets.bucketKeyHash });

  return rows.length === 1;
}

export async function updateThrottleBucketWithExecutor(
  tx: ThrottleBucketsTransaction,
  input: UpdateThrottleBucketInput,
): Promise<void> {
  await tx
    .update(throttleBuckets)
    .set({
      attemptCount: input.attemptCount,
      blockedUntilAt: input.blockedUntilAt,
      updatedAt: input.updatedAt,
      windowStartedAt: input.windowStartedAt,
    })
    .where(
      and(
        eq(throttleBuckets.scope, input.identity.scope),
        eq(throttleBuckets.action, input.identity.action),
        eq(throttleBuckets.bucketKind, input.identity.bucketKind),
        eq(throttleBuckets.bucketKeyHash, input.identity.bucketKeyHash),
      ),
    );
}

export async function deleteThrottleBuckets(
  scope: string,
  action: string,
  bucketKeyHashes: readonly string[],
): Promise<void> {
  if (bucketKeyHashes.length === 0) {
    return;
  }

  await getApiDatabase()
    .delete(throttleBuckets)
    .where(
      and(
        eq(throttleBuckets.scope, scope),
        eq(throttleBuckets.action, action),
        inArray(throttleBuckets.bucketKeyHash, [...bucketKeyHashes]),
      ),
    );
}

export async function deleteExpiredThrottleBuckets(
  scope: string,
  action: string,
  policies: readonly ThrottleBucketWindowPolicy[],
  now: Date,
): Promise<void> {
  if (policies.length === 0) {
    return;
  }

  await getApiDatabase()
    .delete(throttleBuckets)
    .where(
      sql`${throttleBuckets.scope} = ${scope}
        and ${throttleBuckets.action} = ${action}
        and (${buildExpiredThrottleBucketFilter(policies, now)})`,
    );
}

function buildExpiredThrottleBucketFilter(policies: readonly ThrottleBucketWindowPolicy[], now: Date): SQL {
  const conditions: SQL[] = policies.map((policy: ThrottleBucketWindowPolicy): SQL => {
    const expiredWindowBefore: Date = new Date(now.getTime() - policy.windowMs);

    return sql`(
      ${throttleBuckets.bucketKind} = ${policy.bucketKind}
      and ${throttleBuckets.windowStartedAt} <= ${expiredWindowBefore}
      and (${throttleBuckets.blockedUntilAt} is null or ${throttleBuckets.blockedUntilAt} <= ${now})
    )`;
  });

  return sql.join(conditions, sql` or `);
}

const throttleBucketSelection: {
  action: typeof throttleBuckets.action;
  attemptCount: typeof throttleBuckets.attemptCount;
  blockedUntilAt: typeof throttleBuckets.blockedUntilAt;
  bucketKeyHash: typeof throttleBuckets.bucketKeyHash;
  bucketKind: typeof throttleBuckets.bucketKind;
  createdAt: typeof throttleBuckets.createdAt;
  scope: typeof throttleBuckets.scope;
  updatedAt: typeof throttleBuckets.updatedAt;
  windowStartedAt: typeof throttleBuckets.windowStartedAt;
} = {
  action: throttleBuckets.action,
  attemptCount: throttleBuckets.attemptCount,
  blockedUntilAt: throttleBuckets.blockedUntilAt,
  bucketKeyHash: throttleBuckets.bucketKeyHash,
  bucketKind: throttleBuckets.bucketKind,
  createdAt: throttleBuckets.createdAt,
  scope: throttleBuckets.scope,
  updatedAt: throttleBuckets.updatedAt,
  windowStartedAt: throttleBuckets.windowStartedAt,
};

function normalizeThrottleBucketRow(row: PersistedThrottleBucketRow): ThrottleBucketRow {
  return {
    ...row,
    blockedUntilAt: parseNullableDateValue(row.blockedUntilAt),
    createdAt: parseDateValue(row.createdAt),
    updatedAt: parseDateValue(row.updatedAt),
    windowStartedAt: parseDateValue(row.windowStartedAt),
  };
}

function parseNullableDateValue(value: ThrottleBucketTimestampValue | null): Date | null {
  return value === null ? null : parseDateValue(value);
}

function parseDateValue(value: ThrottleBucketTimestampValue): Date {
  return value instanceof Date ? value : new Date(String(value));
}
