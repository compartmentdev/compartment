import { kubeResourceQuotaName } from './kube-naming';
import type { KubeResourceQuotaSpec, ProjectQuota } from './kube-resource-quota-projection.types';
import type { KubeManifest } from './kube-runtime.types';

const projectObjectQuota: Readonly<Record<string, string>> = {
  'count/configmaps': '100',
  'count/deployments.apps': '50',
  'count/jobs.batch': '100',
  'count/networkpolicies.networking.k8s.io': '20',
  'count/persistentvolumeclaims': '20',
  'count/secrets': '100',
  'count/serviceaccounts': '10',
  'count/services': '50',
  pods: '50',
};

export function projectResourceQuotaManifest(
  namespace: string,
  namespaceId: string,
  projectId: string,
  quota: ProjectQuota,
): KubeManifest {
  const spec: KubeResourceQuotaSpec = {
    hard: {
      ...projectObjectQuota,
      'limits.cpu': quota.limitsCpu,
      'limits.memory': quota.limitsMemory,
      'requests.cpu': quota.requestsCpu,
      'requests.memory': quota.requestsMemory,
      'requests.storage': quota.requestsStorage,
    },
  };
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
