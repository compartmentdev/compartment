import type { ProductJobResourceReadiness, ResourceReachabilityEndpoint } from '@compartment/contracts';
import type { ApiDatabaseTransaction } from '../db/client.types';
import { readReleaseResourceIds } from './product-job-release-readiness.query';
import type { ReleaseResourceIdRow } from './product-job-release-readiness.query.types';
import type { ProductJobRunRow } from './product-job-runs.query.types';
import { readResourceReachabilityEndpoints } from './resource-reachability.query';

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
  const endpoints: ResourceReachabilityEndpoint[] = await readResourceReachabilityEndpoints(transaction, resourceIds);
  const startedAt: Date = row.startedAt ?? claimedAt;
  return endpoints.map(
    (endpoint: ResourceReachabilityEndpoint): ProductJobResourceReadiness => ({
      ...endpoint,
      deadlineAt: new Date(startedAt.getTime() + endpoint.timeoutMs).toISOString(),
    }),
  );
}

async function readDialedResourceIds(transaction: ApiDatabaseTransaction, row: ProductJobRunRow): Promise<string[]> {
  if (row.jobClass === 'release') {
    return (await readReleaseResourceIds(transaction, row.identityId)).map(
      (resource: ReleaseResourceIdRow): string => resource.id,
    );
  }
  return row.runtimeIdentity === 'resource' ? (JSON.parse(row.resourceIdsJson) as string[]) : [];
}
