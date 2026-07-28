import { kubeResourceQuotaName } from './kube-naming';
import type { KubeResourceQuotaSpec } from './kube-resource-quota-projection.types';
import type { KubeManifest } from './kube-runtime.types';

const projectQuota: Readonly<Record<string, string>> = {
  'count/configmaps': '100',
  'count/deployments.apps': '50',
  'count/jobs.batch': '100',
  'count/networkpolicies.networking.k8s.io': '20',
  'count/persistentvolumeclaims': '20',
  'count/secrets': '100',
  'count/serviceaccounts': '10',
  'count/services': '50',
  'limits.cpu': '20',
  'limits.memory': '20Gi',
  pods: '50',
  'requests.cpu': '10',
  'requests.memory': '10Gi',
  'requests.storage': '100Gi',
};

export function projectResourceQuotaManifest(namespace: string, namespaceId: string, projectId: string): KubeManifest {
  const spec: KubeResourceQuotaSpec = { hard: { ...projectQuota } };
  return {
    apiVersion: 'v1',
    kind: 'ResourceQuota',
    metadata: {
      labels: {
        'app.kubernetes.io/managed-by': 'compartment',
        'compartment.dev/namespace-id': namespaceId,
        'compartment.dev/project-id': projectId,
      },
      name: kubeResourceQuotaName(namespaceId),
      namespace,
    },
    spec,
  };
}
