import { kubeOrganizationQuotaName } from './kube-naming';
import type {
  GlobalCustomQuotaSource,
  GlobalCustomQuotaSpec,
  OrganizationQuotaProjection,
} from './kube-organization-quota-projection.types';
import type { KubeManifest } from './kube-runtime.types';

const organizationLabel: string = 'compartment.dev/organization-id';
const activePodSelectors: string[] = ['.status.phase!=Succeeded', '.status.phase!=Failed', '.status.phase!=Unknown'];

interface OrganizationQuotaDefinition {
  limit: string;
  resource: string;
  sources: GlobalCustomQuotaSource[];
}

type PodQuotaResource = 'limits-cpu' | 'limits-memory' | 'requests-cpu' | 'requests-memory';

const definitions: OrganizationQuotaDefinition[] = [
  podDefinition('requests-cpu', '2'),
  podDefinition('limits-cpu', '4'),
  podDefinition('requests-memory', '2Gi'),
  podDefinition('limits-memory', '4Gi'),
  {
    limit: '20Gi',
    resource: 'pvc-storage',
    sources: [{ apiVersion: 'v1', kind: 'PersistentVolumeClaim', path: '.spec.resources.requests.storage' }],
  },
];

export function organizationGlobalCustomQuotaManifests(input: OrganizationQuotaProjection): KubeManifest[] {
  return definitions.map((definition: OrganizationQuotaDefinition): KubeManifest => {
    const spec: GlobalCustomQuotaSpec = {
      limit: definition.limit,
      namespaceSelectors: [{ matchLabels: { [organizationLabel]: input.organizationId } }],
      options: { emitMetricPerClaimUsage: false },
      sources: definition.sources,
    };
    return {
      apiVersion: 'capsule.clastix.io/v1beta2',
      kind: 'GlobalCustomQuota',
      metadata: {
        labels: { 'app.kubernetes.io/managed-by': 'compartment', [organizationLabel]: input.organizationId },
        name: kubeOrganizationQuotaName(input.organizationId, definition.resource),
      },
      spec,
    };
  });
}

function podDefinition(resource: PodQuotaResource, limit: string): OrganizationQuotaDefinition {
  const resourcePath: string = resource.replace('-', '.');
  return {
    limit,
    resource,
    sources: [
      {
        apiVersion: 'v1',
        kind: 'Pod',
        path: `.spec.containers[*].resources.${resourcePath}`,
        selectors: [{ fieldSelectors: activePodSelectors }],
      },
      {
        apiVersion: 'v1',
        kind: 'Pod',
        path: `.spec.initContainers[*].resources.${resourcePath}`,
        selectors: [{ fieldSelectors: ['.spec.initContainers', ...activePodSelectors] }],
      },
    ],
  };
}
