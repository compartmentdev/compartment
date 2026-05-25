import type { ResourceRestartPolicy } from '@compartment/contracts';
import { updateNodeResourceRestartPolicy } from '@compartment/sdk';
import type { ProjectResourceRow } from '../queries/resources.query.types';
import { createResourceNodeRequester } from './resource-node-requester.service';
import { requireRunningResourceContainerId } from './resources-runtime-container.service';
import type { ResourceEnvironmentContext } from './resources.service.types';

export async function applyResourceRestartPolicyUpdate(
  context: ResourceEnvironmentContext,
  resource: ProjectResourceRow,
  restartPolicy: ResourceRestartPolicy,
): Promise<void> {
  await updateNodeResourceRestartPolicy(await createResourceNodeRequester(context), {
    containerId: requireRunningResourceContainerId(resource),
    environmentName: context.environment.name,
    projectName: context.project.name,
    resourceName: resource.name,
    restart: {
      policy: restartPolicy,
    },
  });
}
