import type {
  CompartmentAuthoredResourceConfig,
  NodeResourceEnvValue,
  ResourceReconcileIntent,
  ResourceVolumeIntent,
} from '@compartment/contracts';
import { createId } from '../lib/tokens';
import { lockProjectResourceByName, lockProjectResourceReconciliation } from '../queries/resources.query';
import type { ProjectResourceRow, ResourceTransaction } from '../queries/resources.query.types';
import { getApiDatabase } from '../runtime/runtime-access';
import type { EffectiveVariable } from './effective-variables.service.types';
import { requestResourceBootstrap, requestResourceReconcileWithExecutor } from './resource-reconcile-run.service';
import { loadResourceEffectiveVariables } from './resources-effective-variables.service';
import { prepareResourceEffectiveVariables, persistResourceIntent } from './resources-reconcile-persistence.service';
import { assertAllowedVolumeChange } from './resources-reconcile.validation';
import { resolveStoredResourceIntent } from './resources-stored-intent.service';
import { resolveResourceIntent, type ResolvedResourceIntent } from './resources.service.helpers';
import type { ResourceEnvironmentContext } from './resources.service.types';
import type { KubernetesResourceVolumeSource } from './resources-kubernetes-reconcile.service.types';

export function hasKubernetesRuntime(env: NodeJS.ProcessEnv): boolean {
  return (env.KUBERNETES_SERVICE_HOST?.trim() ?? '') !== '' || (env.KUBECONFIG?.trim() ?? '') !== '';
}

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
  await lockProjectResourceReconciliation(tx, context.environment.id, resourceName);
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

async function persistKubernetesDesiredAndRun(
  tx: ResourceTransaction,
  context: ResourceEnvironmentContext,
  existing: ProjectResourceRow | undefined,
  intent: ResolvedResourceIntent,
): Promise<ProjectResourceRow> {
  const persisted: ProjectResourceRow = await persistResourceIntent(
    tx,
    context,
    existing,
    intent,
    new Date(),
    'kubernetes',
  );
  const projected: ResourceReconcileIntent = buildKubernetesResourceIntent(context, persisted, intent);
  await enqueueKubernetesReconcileWhenReady(tx, projected, persisted);
  return persisted;
}

async function enqueueKubernetesReconcileWhenReady(
  tx: ResourceTransaction,
  projected: ResourceReconcileIntent,
  persisted: ProjectResourceRow,
): Promise<void> {
  if (projected.volumes.length > 0 && persisted.expectedClaimsJson === '[]') {
    return;
  }
  await requestResourceReconcileWithExecutor(tx, createId('resource_operation'), projected, persisted);
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
  return resolveResourceIntent(context.project.name, context.environment.name, resourceName, resource, variables);
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
  const intent: ResourceReconcileIntent = buildKubernetesResourceIntent(context, resource, resolved);
  const operationId: string = createId('resource_operation');
  await requestResourceBootstrap(operationId, intent);
}

function buildKubernetesResourceIntent(
  context: ResourceEnvironmentContext,
  resource: ProjectResourceRow,
  intent: ResolvedResourceIntent,
): ResourceReconcileIntent {
  const containerPort: number | undefined = intent.ports[0];
  if (containerPort === undefined) {
    throw new Error(`Kubernetes resource ${resource.id} requires one service port.`);
  }
  return {
    containerPort,
    environmentId: context.environment.id,
    env: Object.fromEntries(intent.runtimeEnv.map(buildRuntimeEnvEntry)),
    image: intent.image,
    namespaceId: context.project.id,
    resourceId: resource.id,
    secretId: resource.id,
    volumes: intent.volumes.map(buildResourceVolumeIntent),
  };
}

function buildRuntimeEnvEntry(variable: NodeResourceEnvValue): [string, string] {
  return [variable.keyName, variable.value];
}

function buildResourceVolumeIntent(volume: KubernetesResourceVolumeSource): ResourceVolumeIntent {
  return { mountPath: volume.mountPath, size: '1Gi', volumeHandle: volume.name };
}
