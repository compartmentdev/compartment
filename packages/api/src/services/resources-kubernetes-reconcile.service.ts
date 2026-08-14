import type { CompartmentAuthoredResourceConfig, ResourceReconcileIntent } from '@compartment/contracts';
import { createProjectArchivedError } from '../errors/api-business-error';
import { createId } from '../lib/tokens';
import { finalizeProjectResourceDeletion } from '../queries/resource-reconcile-deletion.query';
import type { ResourceDeletionFinalizationResult } from '../queries/resource-reconcile-deletion.query.types';
import { updateActiveResourceBootstrapIntent } from '../queries/resource-reconcile-create.query';
import { readLatestResourceReconcileRunStateWithExecutor } from '../queries/resource-reconcile-runs.query';
import type { ResourceReconcileRunState } from '../queries/resource-reconcile-runs.query.types';
import {
  beginProjectResourceDeletion,
  findProjectResourceById,
  lockProjectResourceByName,
  lockProjectResourceReconciliation,
  updateProjectResourceStatus,
} from '../queries/resources.query';
import type { ProjectResourceRow, ResourceTransaction } from '../queries/resources.query.types';
import { getApiDatabase } from '../runtime/runtime-access';
import type { EffectiveVariable } from './effective-variables.service.types';
import {
  requestResourceBootstrap,
  requestResourceReconcile,
  requestResourceReconcileWithExecutor,
  waitForResourceBootstrapForCleanup,
  waitForResourceReconcile,
} from './resource-reconcile-run.service';
import { loadResourceEffectiveVariables } from './resources-effective-variables.service';
import { prepareResourceEffectiveVariables, persistResourceIntent } from './resources-reconcile-persistence.service';
import { assertAllowedVolumeChange } from './resources-reconcile.validation';
import { resolveStoredResourceIntent } from './resources-stored-intent.service';
import { resolveResourceIntent, type ResolvedResourceIntent } from './resources.service.helpers';
import { serializeResourceReadiness } from './resources.service.storage';
import type { ResourceEnvironmentContext } from './resources.service.types';
import { requireFinalizedResourceDeletionDemand, settleResourceDeletion } from './resource-deletion-settlement.service';
import { withResourceOperationLocks } from './resource-operation-lock.service';
import { buildKubernetesResourceIntent } from './resources-kubernetes-intent.service';

export async function reconcileKubernetesResource(
  actorPrincipalId: string,
  context: ResourceEnvironmentContext,
  resourceName: string,
  resource: CompartmentAuthoredResourceConfig,
): Promise<ProjectResourceRow> {
  return await persistKubernetesResource(actorPrincipalId, context, resourceName, resource);
}

async function persistKubernetesResource(
  actorPrincipalId: string,
  context: ResourceEnvironmentContext,
  resourceName: string,
  resource: CompartmentAuthoredResourceConfig,
): Promise<ProjectResourceRow> {
  return await getApiDatabase().transaction(
    async (tx: ResourceTransaction): Promise<ProjectResourceRow> =>
      await persistKubernetesResourceWithTransaction(tx, actorPrincipalId, context, resourceName, resource),
  );
}

async function persistKubernetesResourceWithTransaction(
  tx: ResourceTransaction,
  actorPrincipalId: string,
  context: ResourceEnvironmentContext,
  resourceName: string,
  resource: CompartmentAuthoredResourceConfig,
): Promise<ProjectResourceRow> {
  await assertResourceReconciliationAllowed(tx, context.environment.id, resourceName);
  const intent: ResolvedResourceIntent = await resolveKubernetesResourceIntent(
    tx,
    actorPrincipalId,
    context,
    resourceName,
    resource,
  );
  const existing: ProjectResourceRow | undefined = await lockProjectResourceByName(
    tx,
    context.environment.id,
    resourceName,
  );
  if (existing !== undefined) {
    assertAllowedVolumeChange(existing, intent);
  }
  return await persistKubernetesDesiredAndRun(tx, context, existing, intent);
}

async function assertResourceReconciliationAllowed(
  tx: ResourceTransaction,
  environmentId: string,
  resourceName: string,
): Promise<void> {
  const archivedAt: Date | null = await lockProjectResourceReconciliation(tx, environmentId, resourceName);
  if (archivedAt !== null) {
    throw createProjectArchivedError();
  }
}

async function persistKubernetesDesiredAndRun(
  tx: ResourceTransaction,
  context: ResourceEnvironmentContext,
  existing: ProjectResourceRow | undefined,
  intent: ResolvedResourceIntent,
): Promise<ProjectResourceRow> {
  const keepActive: boolean = await canKeepActiveResource(tx, existing, intent);
  const persisted: ProjectResourceRow = await persistResourceIntent(tx, context, existing, intent, new Date());
  const projected: ResourceReconcileIntent = buildKubernetesResourceIntent(context, persisted, intent, 1);
  await enqueueKubernetesReconcileWhenReady(tx, projected, persisted, keepActive);
  return persisted;
}

async function enqueueKubernetesReconcileWhenReady(
  tx: ResourceTransaction,
  projected: ResourceReconcileIntent,
  persisted: ProjectResourceRow,
  keepActive: boolean,
): Promise<void> {
  if (persisted.expectedClaimsJson === '[]') {
    await updateActiveResourceBootstrapIntent(tx, projected);
    return;
  }
  if (keepActive) {
    return;
  }
  await requestResourceReconcileWithExecutor(tx, createId('resource_operation'), projected, persisted);
}

async function canKeepActiveResource(
  tx: ResourceTransaction,
  existing: ProjectResourceRow | undefined,
  intent: ResolvedResourceIntent,
): Promise<boolean> {
  if (
    existing === undefined ||
    existing.expectedClaimsJson === '[]' ||
    existing.status !== 'running' ||
    existing.runtimeDefinitionHash !== intent.runtimeHash ||
    existing.readinessJson !== serializeResourceReadiness(intent.readiness)
  ) {
    return false;
  }
  const latest: ResourceReconcileRunState | null = await readLatestResourceReconcileRunStateWithExecutor(
    tx,
    existing.id,
  );
  return latest?.phase === 'succeeded';
}

async function resolveKubernetesResourceIntent(
  tx: ResourceTransaction,
  actorPrincipalId: string,
  context: ResourceEnvironmentContext,
  resourceName: string,
  resource: CompartmentAuthoredResourceConfig,
): Promise<ResolvedResourceIntent> {
  const variables: EffectiveVariable[] = await prepareResourceEffectiveVariables(
    tx,
    actorPrincipalId,
    context,
    resourceName,
    resource,
  );
  return resolveResourceIntent(resourceName, resource, variables);
}

export async function bootstrapKubernetesResource(
  context: ResourceEnvironmentContext,
  resource: ProjectResourceRow,
): Promise<void> {
  const variables: EffectiveVariable[] = await loadResourceEffectiveVariables(
    context.environment.id,
    context.organization.id,
    resource.name,
  );
  const resolved: ResolvedResourceIntent = resolveStoredResourceIntent(resource, variables);
  const intent: ResourceReconcileIntent = buildKubernetesResourceIntent(context, resource, resolved, 1);
  const operationId: string = createId('resource_operation');
  await requestResourceBootstrap(operationId, intent);
}

export async function reconcileKubernetesResourceReplicas(
  context: ResourceEnvironmentContext,
  resource: ProjectResourceRow,
  replicas: 0 | 1,
): Promise<ProjectResourceRow> {
  const current: ProjectResourceRow = await prepareResourceReplicaChange(resource, replicas);
  if (replicas === 0 && hasUnbootstrappedClaims(current)) {
    return current;
  }
  const variables: EffectiveVariable[] = await loadResourceEffectiveVariables(
    context.environment.id,
    context.organization.id,
    current.name,
  );
  const intent: ResourceReconcileIntent = buildKubernetesResourceIntent(
    context,
    current,
    resolveStoredResourceIntent(current, variables),
    replicas,
  );
  const operationId: string = createId('resource_operation');
  await requestResourceReconcile(operationId, intent, current);
  await waitForResourceReconcile(operationId);
  return await requireProjectResource(resource.id);
}

export async function deleteKubernetesResource(
  context: ResourceEnvironmentContext,
  resource: ProjectResourceRow,
  deleteData: boolean,
): Promise<boolean> {
  let current: ProjectResourceRow = await prepareResourceDeletion(resource.id, deleteData);
  for (;;) {
    await settleResourceDeletion(context, current);
    const finalization: ResourceDeletionFinalizationResult = await finalizeProjectResourceDeletion(current.id);
    if (finalization.finalized) {
      return requireFinalizedResourceDeletionDemand(finalization, current.id);
    }
    const pending: ProjectResourceRow | undefined = await findProjectResourceById(current.id);
    if (pending === undefined) {
      const concurrent: ResourceDeletionFinalizationResult = await finalizeProjectResourceDeletion(current.id);
      return requireFinalizedResourceDeletionDemand(concurrent, current.id);
    }
    current = pending;
  }
}

async function prepareResourceDeletion(resourceId: string, deleteData: boolean): Promise<ProjectResourceRow> {
  const deleting: ProjectResourceRow = await withResourceOperationLocks(
    [resourceId],
    async (): Promise<ProjectResourceRow> => await beginProjectResourceDeletion(resourceId, deleteData),
  );
  return hasUnbootstrappedClaims(deleting) ? await waitForResourceBootstrapForCleanup(resourceId) : deleting;
}

async function prepareResourceReplicaChange(
  resource: ProjectResourceRow,
  replicas: 0 | 1,
): Promise<ProjectResourceRow> {
  if (replicas === 1 || !hasUnbootstrappedClaims(resource)) {
    return resource;
  }
  const stopped: ProjectResourceRow = await persistResourceReplicaStatus(resource.id, 0);
  const bootstrapped: ProjectResourceRow = await waitForResourceBootstrapForCleanup(resource.id);
  return hasUnbootstrappedClaims(bootstrapped) ? stopped : bootstrapped;
}

async function persistResourceReplicaStatus(resourceId: string, replicas: 0 | 1): Promise<ProjectResourceRow> {
  return await updateProjectResourceStatus({
    projectResourceId: resourceId,
    status: replicas === 0 ? 'stopped' : 'running',
    updatedAt: new Date(),
  });
}

async function requireProjectResource(resourceId: string): Promise<ProjectResourceRow> {
  const resource: ProjectResourceRow | undefined = await findProjectResourceById(resourceId);
  if (resource === undefined) {
    throw new Error('Resource disappeared after Kubernetes reconciliation.');
  }
  return resource;
}

function hasUnbootstrappedClaims(resource: ProjectResourceRow): boolean {
  return resource.expectedClaimsJson === '[]';
}
