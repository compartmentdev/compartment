import { kubeOrganizationQuotaName } from './kube-naming';
import type {
  GlobalCustomQuotaSource,
  GlobalCustomQuotaSpec,
  OrganizationQuotaCapacity,
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

const organizationQuotaCapacity: OrganizationQuotaCapacity = {
  limitsCpu: '20',
  limitsMemory: '20Gi',
  requestsCpu: '20',
  requestsMemory: '20Gi',
  requestsStorage: '100Gi',
};

const definitions: OrganizationQuotaDefinition[] = [
  podDefinition('requests-cpu', organizationQuotaCapacity.requestsCpu),
  podDefinition('limits-cpu', organizationQuotaCapacity.limitsCpu),
  podDefinition('requests-memory', organizationQuotaCapacity.requestsMemory),
  podDefinition('limits-memory', organizationQuotaCapacity.limitsMemory),
  {
    limit: organizationQuotaCapacity.requestsStorage,
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
