import type { ResourceReconcileIntent } from '@compartment/contracts';
import { createId } from '../lib/tokens';
import { readLatestResourceDeletionRun } from '../queries/resource-reconcile-deletion.query';
import type { ResourceDeletionFinalizationResult } from '../queries/resource-reconcile-deletion.query.types';
import type { ResourceDeletionRunState } from '../queries/resource-reconcile-runs.query.types';
import type { ProjectResourceRow } from '../queries/resources.query.types';
import { requestResourceReconcile, waitForResourceReconcile } from './resource-reconcile-run.service';
import { loadResourceEffectiveVariables } from './resources-effective-variables.service';
import { buildKubernetesResourceIntent } from './resources-kubernetes-intent.service';
import { resolveStoredResourceIntent } from './resources-stored-intent.service';
import type { ResourceEnvironmentContext } from './resources.service.types';
import type { EffectiveVariable } from './effective-variables.service.types';

export async function settleResourceDeletion(
  context: ResourceEnvironmentContext,
  resource: ProjectResourceRow,
): Promise<void> {
  if (
    resource.expectedClaimsJson === '[]' ||
    (await settleExistingResourceDeletion(resource.id, resource.deleteDataRequested))
  ) {
    return;
  }
  const intent: ResourceReconcileIntent = await buildResourceDeletionIntent(
    context,
    resource,
    resource.deleteDataRequested,
  );
  const operationId: string = createId('resource_operation');
  await requestResourceReconcile(operationId, intent, resource);
  await waitForResourceReconcile(operationId);
}

async function settleExistingResourceDeletion(resourceId: string, deleteData: boolean): Promise<boolean> {
  for (;;) {
    const deletion: ResourceDeletionRunState | null = await readLatestResourceDeletionRun(resourceId);
    if (deletion === null || deletion.phase === 'failed') {
      return false;
    }
    if (deletion.phase === 'succeeded') {
      return !deleteData || deletion.deleteData;
    }
    await waitForResourceReconcile(deletion.operationId);
  }
}

export function requireFinalizedResourceDeletionDemand(
  result: ResourceDeletionFinalizationResult,
  resourceId: string,
): boolean {
  if (!result.finalized || result.deleteData === null) {
    throw new Error(`Resource ${resourceId} deletion did not reach a durable outcome.`);
  }
  return result.deleteData;
}

async function buildResourceDeletionIntent(
  context: ResourceEnvironmentContext,
  resource: ProjectResourceRow,
  deleteData: boolean,
): Promise<ResourceReconcileIntent> {
  const variables: EffectiveVariable[] = await loadResourceEffectiveVariables(
    context.environment.id,
    context.organization.id,
    resource.name,
  );
  return {
    ...buildKubernetesResourceIntent(context, resource, resolveStoredResourceIntent(resource, variables), 0),
    deleteData,
    operation: 'delete',
  };
}
