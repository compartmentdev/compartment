import { buildDockerNamespaceLabels } from '@compartment/docker';
import type { NodeResourceRequest } from '@compartment/contracts';
import { environmentIdLabelName, projectIdLabelName } from './runtime-container-labels';

export const resourceNameLabelName: string = 'compartment.resource';

export function buildRuntimeResourceLabels(
  dockerNamespace: string,
  input: NodeResourceRequest,
): Record<string, string> {
  return {
    ...buildDockerNamespaceLabels(dockerNamespace),
    [environmentIdLabelName]: input.environmentId,
    [projectIdLabelName]: input.projectId,
    'compartment.environment': input.environmentName,
    'compartment.project': input.projectName,
    [resourceNameLabelName]: input.resourceName,
  };
}
