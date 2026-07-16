import { createProjectResourceWithExecutor } from '../queries/resources.query';
import type { ProjectResourceRow, ResourceTransaction } from '../queries/resources.query.types';
import { createResourceInsert } from './resources-resource-insert.service';
import { bootstrapKubernetesResource } from './resources-kubernetes-reconcile.service';
import { waitForResourceBootstrap, waitForResourceRunning } from './resource-reconcile-run.service';
import type { ResolvedResourceIntent } from './resources.service.helpers';
import type { ResourceEnvironmentContext } from './resources.service.types';

export async function prepareRestoredResourceRuntime(
  context: ResourceEnvironmentContext,
  resource: ProjectResourceRow,
): Promise<ProjectResourceRow> {
  await bootstrapKubernetesResource(context, resource);
  await waitForResourceBootstrap(resource.id);
  return await waitForResourceRunning(resource.id);
}

export async function createKubernetesRestoredResourceWithLock(
  tx: ResourceTransaction,
  context: ResourceEnvironmentContext,
  intent: ResolvedResourceIntent,
): Promise<ProjectResourceRow> {
  return await createProjectResourceWithExecutor(tx, createResourceInsert(context.environment.id, intent, new Date()));
}
