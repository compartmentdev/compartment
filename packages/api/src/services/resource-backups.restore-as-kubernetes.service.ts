import { setTimeout as delay } from 'node:timers/promises';
import { createProjectResourceWithExecutor, findProjectResourceByName } from '../queries/resources.query';
import type { ProjectResourceRow, ResourceTransaction } from '../queries/resources.query.types';
import { createResourceInsert } from './resources-resource-insert.service';
import { bootstrapKubernetesResource } from './resources-kubernetes-reconcile.service';
import type { ResolvedResourceIntent } from './resources.service.helpers';
import type { ResourceEnvironmentContext } from './resources.service.types';

export async function prepareRestoredResourceRuntime(
  context: ResourceEnvironmentContext,
  resource: ProjectResourceRow,
): Promise<ProjectResourceRow> {
  if (resource.runtimeKind === 'node') {
    return resource;
  }
  await bootstrapKubernetesResource(context, resource);
  const expiresAt: number = Date.now() + 120_000;
  while (Date.now() < expiresAt) {
    const current: ProjectResourceRow | undefined = await findProjectResourceByName(
      context.environment.id,
      resource.name,
    );
    if (current?.status === 'running' && current.expectedClaimsJson !== '[]') {
      return current;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for restored Kubernetes resource ${resource.name}.`);
}

export async function createKubernetesRestoredResourceWithLock(
  tx: ResourceTransaction,
  context: ResourceEnvironmentContext,
  intent: ResolvedResourceIntent,
): Promise<ProjectResourceRow> {
  return await createProjectResourceWithExecutor(
    tx,
    createResourceInsert(context.environment.id, intent, new Date(), 'kubernetes'),
  );
}
