import type { KubeLimitRangeResources, KubeLimitRangeSpec } from './kube-limit-range-projection.types';
import { kubeLimitRangeName } from './kube-naming';
import type { KubeManifest } from './kube-runtime.types';

const projectContainerDefaultRequest: Readonly<KubeLimitRangeResources> = { cpu: '50m', memory: '128Mi' };
const projectContainerDefaultLimit: Readonly<KubeLimitRangeResources> = { cpu: '1', memory: '1Gi' };

export function projectLimitRangeManifest(namespace: string, namespaceId: string, projectId: string): KubeManifest {
  const spec: KubeLimitRangeSpec = {
    limits: [
      {
        default: { ...projectContainerDefaultLimit },
        defaultRequest: { ...projectContainerDefaultRequest },
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
