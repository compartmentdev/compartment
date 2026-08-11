import { kubeOrganizationQuotaName } from './kube-naming';
import type {
  GlobalCustomQuotaSource,
  GlobalCustomQuotaSpec,
  OrganizationQuotaCapacity,
  OrganizationQuotaProjection,
} from './kube-organization-quota-projection.types';
import type { KubeManifest } from './kube-runtime.types';

const organizationLabel: string = 'compartment.dev/organization-id';
const reconcileRequestedAtAnnotation: string = 'reconcile.projectcapsule.dev/requestedAt';
const activePodSelectors: string[] = ['.status.phase!=Succeeded', '.status.phase!=Failed', '.status.phase!=Unknown'];

interface OrganizationQuotaDefinition {
  limit: string;
  resource: string;
  sources: GlobalCustomQuotaSource[];
}

type PodQuotaResource = 'limits-cpu' | 'limits-memory' | 'requests-cpu' | 'requests-memory';

export function organizationGlobalCustomQuotaManifests(input: OrganizationQuotaProjection): KubeManifest[] {
  const definitions: OrganizationQuotaDefinition[] = organizationQuotaDefinitions(input.capacity);
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
        annotations: { [reconcileRequestedAtAnnotation]: input.reconciliationRequestedAt },
        labels: { 'app.kubernetes.io/managed-by': 'compartment', [organizationLabel]: input.organizationId },
        name: kubeOrganizationQuotaName(input.organizationId, definition.resource),
      },
      spec,
    };
  });
}

function organizationQuotaDefinitions(capacity: OrganizationQuotaCapacity): OrganizationQuotaDefinition[] {
  return [
    podDefinition('requests-cpu', capacity.requestsCpu),
    podDefinition('limits-cpu', capacity.limitsCpu),
    podDefinition('requests-memory', capacity.requestsMemory),
    podDefinition('limits-memory', capacity.limitsMemory),
    {
      limit: capacity.requestsStorage,
      resource: 'pvc-storage',
      sources: [{ apiVersion: 'v1', kind: 'PersistentVolumeClaim', path: '.spec.resources.requests.storage' }],
    },
  ];
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
