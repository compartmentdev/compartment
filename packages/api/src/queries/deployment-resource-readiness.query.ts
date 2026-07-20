import { and, asc, eq, type SQL } from 'drizzle-orm';
import type { SelectedFields } from 'drizzle-orm/pg-core/query-builders/select.types';
import {
  deploymentKubeReferences,
  deployments,
  environmentResourceOutputVariableBindings,
  projectResources,
  projectServices,
} from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type { FailedDeploymentResourcePrerequisite } from './deployment-resource-readiness.query.types';
import {
  latestResourceReconcileRunFailureMessage,
  latestResourceReconcileRunHasPhase,
} from './latest-resource-reconcile-run.query';

interface FailedPrerequisiteSelection extends SelectedFields {
  deploymentId: typeof deployments.id;
  failureMessage: SQL<string | null>;
  resourceId: typeof projectResources.id;
  revision: typeof deploymentKubeReferences.revision;
}

export async function findFailedDeploymentResourcePrerequisite(): Promise<FailedDeploymentResourcePrerequisite | null> {
  const [row] = await getApiDatabase()
    .select(failedPrerequisiteSelection())
    .from(deploymentKubeReferences)
    .innerJoin(deployments, eq(deployments.id, deploymentKubeReferences.deploymentId))
    .innerJoin(projectServices, eq(projectServices.id, deployments.projectServiceId))
    .innerJoin(projectResources, eq(projectResources.environmentId, deployments.environmentId))
    .innerJoin(environmentResourceOutputVariableBindings, resourceBindingFilter())
    .where(failedPrerequisiteFilter())
    .orderBy(asc(deploymentKubeReferences.transitionedAt), asc(deployments.id))
    .limit(1);
  if (row === undefined) {
    return null;
  }
  return {
    deploymentId: row.deploymentId,
    failureMessage: `Resource ${row.resourceId} failed before release: ${row.failureMessage ?? 'unknown failure'}`,
    revision: row.revision,
  };
}

function failedPrerequisiteSelection(): FailedPrerequisiteSelection {
  return {
    deploymentId: deployments.id,
    failureMessage: latestResourceReconcileRunFailureMessage(projectResources.id),
    resourceId: projectResources.id,
    revision: deploymentKubeReferences.revision,
  };
}

function resourceBindingFilter(): SQL | undefined {
  return and(
    eq(environmentResourceOutputVariableBindings.environmentId, deployments.environmentId),
    eq(environmentResourceOutputVariableBindings.resourceName, projectResources.name),
    eq(environmentResourceOutputVariableBindings.targetServiceName, projectServices.name),
  );
}

function failedPrerequisiteFilter(): SQL | undefined {
  return and(
    eq(deploymentKubeReferences.state, 'desired'),
    eq(deployments.status, 'running'),
    eq(environmentResourceOutputVariableBindings.source, 'descriptor'),
    latestResourceReconcileRunHasPhase(projectResources.id, 'failed'),
  );
}
