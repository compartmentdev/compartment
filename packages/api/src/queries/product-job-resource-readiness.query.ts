import type { ProductJobResourceReadiness, ResourceReadinessSummary } from '@compartment/contracts';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { ApiDatabaseTransaction } from '../db/client.types';
import { projectResources } from '../db/schema';
import { readReleaseResourceIds } from './product-job-release-readiness.query';
import type { ReleaseResourceIdRow } from './product-job-release-readiness.query.types';
import type { ProductJobRunRow } from './product-job-runs.query.types';
import type { DeclaredResourceReadinessRow } from './product-job-resource-readiness.query.types';

/**
 * Resources the claimed Job dials, with the instant each one must be accepting connections by.
 * Resolved inside the claim transaction, so a resource created, replaced, or reconfigured after the Job
 * was queued is still covered. A Job that only touches a resource's artifact volume dials nothing, and a
 * resource the operator stopped is never expected to accept connections, so neither is gated. The
 * readiness budget runs from the first claim, not from every re-claim.
 */
export async function readProductJobResourceReadiness(
  transaction: ApiDatabaseTransaction,
  row: ProductJobRunRow,
  claimedAt: Date,
): Promise<ProductJobResourceReadiness[]> {
  const resourceIds: string[] = await readDialedResourceIds(transaction, row);
  if (resourceIds.length === 0) {
    return [];
  }
  const startedAt: Date = row.startedAt ?? claimedAt;
  const rows: DeclaredResourceReadinessRow[] = await transaction
    .select({ readinessJson: projectResources.readinessJson, resourceId: projectResources.id })
    .from(projectResources)
    .where(and(inArray(projectResources.id, resourceIds), eq(projectResources.status, 'running')))
    .orderBy(asc(projectResources.id));
  return rows.flatMap((declared: DeclaredResourceReadinessRow): ProductJobResourceReadiness[] => {
    const readiness: ResourceReadinessSummary | null = JSON.parse(
      declared.readinessJson,
    ) as ResourceReadinessSummary | null;
    if (readiness === null) {
      return [];
    }
    return [
      {
        deadlineAt: new Date(startedAt.getTime() + readiness.timeoutMs).toISOString(),
        resourceId: declared.resourceId,
      },
    ];
  });
}

async function readDialedResourceIds(transaction: ApiDatabaseTransaction, row: ProductJobRunRow): Promise<string[]> {
  if (row.jobClass === 'release') {
    return (await readReleaseResourceIds(transaction, row.identityId)).map(
      (resource: ReleaseResourceIdRow): string => resource.id,
    );
  }
  return row.runtimeIdentity === 'resource' ? (JSON.parse(row.resourceIdsJson) as string[]) : [];
}
