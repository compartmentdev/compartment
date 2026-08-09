import { sql, type SQL } from 'drizzle-orm';
import {
  deployments,
  environmentResourceOutputVariableBindings,
  productJobRuns,
  projectResources,
  projectServices,
  resourceReconcileRuns,
} from '../db/schema';

/** Descriptor output bindings are the only record of which resources a release declares. */
export function releaseResourceBindingCondition(): SQL {
  return sql`${environmentResourceOutputVariableBindings.environmentId} = ${deployments.environmentId}
    and ${environmentResourceOutputVariableBindings.targetServiceName} = ${projectServices.name}
    and ${environmentResourceOutputVariableBindings.source} = 'descriptor'`;
}

export function releaseProjectResourceCondition(): SQL {
  return sql`${projectResources.environmentId} = ${deployments.environmentId}
    and ${projectResources.name} = ${environmentResourceOutputVariableBindings.resourceName}`;
}

/**
 * Correlates the release Job row in scope with the resource reconcile run row in scope. Release Jobs persist an empty
 * `resourceIdsJson`, so the deployment's descriptor bindings are the only path from a release to the resources it
 * dials. Bindings resolve on every read, so a rebound resource changes which reconcile a live release Job fences.
 */
export function releaseJobDialsReconciledResource(): SQL {
  return sql`exists (
    select 1
    from ${deployments}
    inner join ${projectServices}
      on ${projectServices.id} = ${deployments.projectServiceId}
    inner join ${environmentResourceOutputVariableBindings}
      on ${releaseResourceBindingCondition()}
    inner join ${projectResources}
      on ${releaseProjectResourceCondition()}
    where ${deployments.id} = ${productJobRuns.identityId}
      and ${projectResources.id} = ${resourceReconcileRuns.projectResourceId}
  )`;
}
