import { sql, type SQL } from 'drizzle-orm';
import { productJobRuns, resourceReconcileRuns } from '../db/schema';
import { releaseJobDialsReconciledResource } from './product-job-release-bindings.query';

/**
 * Whether the Product Job row in scope holds the resource of the reconcile run row in scope. This is the only site
 * that decides it: the reconcile claim uses it to refuse admission, and the reconcile wait uses it to size the
 * budget it must wait out. Both must read the same set or a reconcile waits on work it was never blocked by.
 */
export function fencingProductJobCondition(): SQL {
  return sql`${productJobRuns.finalizedAt} is null
    and (
      (${fencingResourceOperationJob()})
      or (${fencingReleaseJob()})
    )`;
}

/**
 * A resource operation carries its own resource ids and arbitrates with a reconcile by age, so a queued operation
 * fences only the reconciles queued after it. `resourceOperationReconcileFence` is the matching half of that rule.
 */
function fencingResourceOperationJob(): SQL {
  return sql`${productJobRuns.jobClass} = 'resource-operation'
    and exists (
      select 1
      from jsonb_array_elements_text(${productJobRuns.resourceIdsJson}::jsonb) resource_ids(resource_id)
      where resource_id = ${resourceReconcileRuns.projectResourceId}
    )
    and (
      ${productJobRuns.status} <> 'queued'
      or (${productJobRuns.createdAt}, ${productJobRuns.id})
        < (${resourceReconcileRuns.createdAt}, ${resourceReconcileRuns.id})
    )`;
}

/**
 * A release fences from the moment its manifest goes to the API server until its Kubernetes Job is finalized. The
 * marker is the only durable record of that: `status` turns `running` when the row is claimed, which is before the
 * readiness gate decides, and a gate that declines leaves a claimed release that never reached the cluster. Age
 * never fences a release. `releaseResourceReadinessFence` already holds a queued release until the newest reconcile
 * for every resource it declares has succeeded, so an age tie-break here would let a release created before the
 * bootstrap follow-up run block the very reconcile that readies it.
 */
function fencingReleaseJob(): SQL {
  return sql`${productJobRuns.jobClass} = 'release'
    and ${productJobRuns.kubeJobSubmittedAt} is not null
    and ${releaseJobDialsReconciledResource()}`;
}
