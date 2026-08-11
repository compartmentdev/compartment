import type { KubeLimitRangeSpec, ProjectContainerDefaults } from './kube-limit-range-projection.types';
import { kubeLimitRangeName } from './kube-naming';
import type { KubeManifest } from './kube-runtime.types';

export function projectLimitRangeManifest(
  namespace: string,
  namespaceId: string,
  projectId: string,
  defaults: ProjectContainerDefaults,
): KubeManifest {
  const spec: KubeLimitRangeSpec = {
    limits: [
      {
        _default: { ...defaults.limit },
        defaultRequest: { ...defaults.request },
        type: 'Container',
      },
    ],
  };
  return {
    apiVersion: 'v1',
    kind: 'LimitRange',
    metadata: {
      labels: {
        'app.kubernetes.io/managed-by': 'compartment',
        'compartment.dev/namespace-id': namespaceId,
        'compartment.dev/project-id': projectId,
      },
      name: kubeLimitRangeName(namespaceId),
      namespace,
    },
    spec,
  };
}
