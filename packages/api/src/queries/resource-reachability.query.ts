import type { ResourceReachabilityEndpoint, ResourceReadinessSummary } from '@compartment/contracts';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { ApiDatabaseTransaction } from '../db/client.types';
import { projectResources } from '../db/schema';
import type { DeclaredResourceReadinessRow } from './product-job-resource-readiness.query.types';

/**
 * The endpoints a workload is expected to reach among the resources it dials.
 *
 * Two exclusions are deliberate and shared by every caller. A resource the operator stopped is never expected to
 * accept connections, and a resource that declares no readiness publishes no endpoint to wait on. Both drop out
 * here rather than in each caller, so the release Job gate, the Job's own Pod, and the application's Pod all agree
 * on which resources are gated.
 */
export async function readResourceReachabilityEndpoints(
  executor: ApiDatabaseTransaction | Database,
  resourceIds: readonly string[],
): Promise<ResourceReachabilityEndpoint[]> {
  if (resourceIds.length === 0) {
    return [];
  }
  const rows: DeclaredResourceReadinessRow[] = await executor
    .select({ readinessJson: projectResources.readinessJson, resourceId: projectResources.id })
    .from(projectResources)
    .where(and(inArray(projectResources.id, [...resourceIds]), eq(projectResources.status, 'running')))
    .orderBy(asc(projectResources.id));
  return rows.flatMap(declaredResourceEndpoint);
}

function declaredResourceEndpoint(declared: DeclaredResourceReadinessRow): ResourceReachabilityEndpoint[] {
  const readiness: ResourceReadinessSummary | null = JSON.parse(
    declared.readinessJson,
  ) as ResourceReadinessSummary | null;
  if (readiness === null) {
    return [];
  }
  return [{ port: readiness.port, resourceId: declared.resourceId, timeoutMs: readiness.timeoutMs }];
}
