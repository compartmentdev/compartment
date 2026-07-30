import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { ApiDatabaseTransaction } from '../db/client.types';
import { edgeTrafficUsageReceipts, workloadUsageHourly } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { readDeploymentUsageOwnerByUpstreamHost } from './deployment-usage-owner.query';
import type { DeploymentUsageOwner } from './deployment-usage-owner.query.types';
import type { DeleteExpiredUsageBatchInput } from './usage-metering.query.types';
import type {
  EdgeTrafficUsageMetricInput,
  EdgeTrafficUsageIncrement,
  EdgeTrafficUsageRow,
  RecordEdgeTrafficUsageInput,
} from './edge-traffic-metering.query.types';

export async function recordEdgeTrafficUsage(input: RecordEdgeTrafficUsageInput): Promise<boolean> {
  return await getApiDatabase().transaction(async (tx: ApiDatabaseTransaction): Promise<boolean> => {
    const [receipt] = await tx
      .insert(edgeTrafficUsageReceipts)
      .values({ batchId: input.batchId, sourceId: input.sourceId })
      .onConflictDoNothing()
      .returning({ batchId: edgeTrafficUsageReceipts.batchId });
    if (receipt === undefined) {
      return false;
    }
    for (const metric of input.metrics) {
      await recordEdgeTrafficMetric(tx, metric);
    }
    return true;
  });
}

async function recordEdgeTrafficMetric(tx: ApiDatabaseTransaction, metric: EdgeTrafficUsageMetricInput): Promise<void> {
  const owner: DeploymentUsageOwner | undefined = await readDeploymentUsageOwnerByUpstreamHost(tx, metric.upstreamHost);
  if (owner === undefined) {
    return;
  }
  await incrementEdgeTrafficHour(tx, buildEdgeTrafficUsageRow(owner, metric));
}

async function incrementEdgeTrafficHour(tx: ApiDatabaseTransaction, row: EdgeTrafficUsageRow): Promise<void> {
  await tx
    .insert(workloadUsageHourly)
    .values(row)
    .onConflictDoUpdate({
      set: buildEdgeTrafficUsageIncrement(row),
      target: [
        workloadUsageHourly.organizationId,
        workloadUsageHourly.projectId,
        workloadUsageHourly.environmentId,
        workloadUsageHourly.serviceId,
        workloadUsageHourly.hourBucket,
      ],
      targetWhere: sql`${workloadUsageHourly.serviceId} is not null`,
    });
}

function buildEdgeTrafficUsageRow(
  owner: DeploymentUsageOwner,
  metric: EdgeTrafficUsageMetricInput,
): EdgeTrafficUsageRow {
  return {
    ...owner,
    hourBucket: metric.hourBucket,
    requestBytes: metric.requestBytes,
    requestCount: metric.requestCount,
    resourceId: null,
    responseBytes: metric.responseBytes,
    status4xxCount: metric.status4xxCount,
    status5xxCount: metric.status5xxCount,
  };
}

function buildEdgeTrafficUsageIncrement(row: EdgeTrafficUsageRow): EdgeTrafficUsageIncrement {
  return {
    requestBytes: sql`${workloadUsageHourly.requestBytes} + ${row.requestBytes}`,
    requestCount: sql`${workloadUsageHourly.requestCount} + ${row.requestCount}`,
    responseBytes: sql`${workloadUsageHourly.responseBytes} + ${row.responseBytes}`,
    status4xxCount: sql`${workloadUsageHourly.status4xxCount} + ${row.status4xxCount}`,
    status5xxCount: sql`${workloadUsageHourly.status5xxCount} + ${row.status5xxCount}`,
    updatedAt: new Date(),
  };
}

export async function deleteEdgeTrafficReceiptBatch(
  database: Database,
  input: DeleteExpiredUsageBatchInput,
): Promise<number> {
  const result: { rowCount: number | null } = await database.execute(sql`
    with doomed as (
      select ctid from ${edgeTrafficUsageReceipts}
      where ${edgeTrafficUsageReceipts.createdAt} < ${input.before} limit ${input.limit}
    )
    delete from ${edgeTrafficUsageReceipts} where ctid in (select ctid from doomed)
  `);
  return result.rowCount ?? 0;
}
