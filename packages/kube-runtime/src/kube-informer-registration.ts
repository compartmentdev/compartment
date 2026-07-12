import type {
  Informer,
  KubeConfig,
  KubernetesListObject,
  KubernetesObject,
  KubernetesObjectApi,
} from '@kubernetes/client-node';
import { createKubeInformer } from './kube-client-node';
import type { KubeObservedResource, ObserveLabels } from './kube-runtime.types';

interface InformerDefinition {
  apiVersion: string;
  kind: string;
  path: string;
  resource: KubeObservedResource;
}

export class RegisteredInformer {
  public constructor(
    public readonly definition: InformerDefinition,
    private readonly kubeConfig: KubeConfig,
    private readonly objectApi: KubernetesObjectApi,
    private readonly namespace: string,
    private readonly selector: string,
  ) {}

  public createInformer(): Informer<KubernetesObject> {
    return createKubeInformer(
      this.kubeConfig,
      informerPath(this.definition, this.namespace),
      async (): Promise<KubernetesListObject<KubernetesObject>> => await this.listObjects(),
      this.selector,
    );
  }

  private async listObjects(): Promise<KubernetesListObject<KubernetesObject>> {
    return await this.objectApi.list(
      this.definition.apiVersion,
      this.definition.kind,
      this.namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      this.selector,
    );
  }
}

const definitions: Readonly<Record<KubeObservedResource, InformerDefinition>> = {
  deployments: createDefinition('apps/v1', 'Deployment', 'apis/apps/v1/deployments', 'deployments'),
  jobs: createDefinition('batch/v1', 'Job', 'apis/batch/v1/jobs', 'jobs'),
  networkpolicies: createDefinition(
    'networking.k8s.io/v1',
    'NetworkPolicy',
    'apis/networking.k8s.io/v1/networkpolicies',
    'networkpolicies',
  ),
  pods: createDefinition('v1', 'Pod', 'api/v1/pods', 'pods'),
  secrets: createDefinition('v1', 'Secret', 'api/v1/secrets', 'secrets'),
  services: createDefinition('v1', 'Service', 'api/v1/services', 'services'),
};

export function createRegisteredInformers(
  kubeConfig: KubeConfig,
  objectApi: KubernetesObjectApi,
  input: ObserveLabels,
): RegisteredInformer[] {
  const selector: string = labelSelector(input.labels);
  return input.resources.map(
    (resource: KubeObservedResource): RegisteredInformer =>
      new RegisteredInformer(definitions[resource], kubeConfig, objectApi, input.namespace, selector),
  );
}

function createDefinition(
  apiVersion: string,
  kind: string,
  path: string,
  resource: KubeObservedResource,
): InformerDefinition {
  return { apiVersion, kind, path, resource };
}

function labelSelector(labels: Readonly<Record<string, string>>): string {
  const entries: [string, string][] = Object.entries(labels).sort(
    ([left]: [string, string], [right]: [string, string]): number => left.localeCompare(right),
  );
  if (entries.length === 0) {
    throw new Error('observe(labels) requires at least one ownership label.');
  }
  return entries.map(([key, value]: [string, string]): string => `${key}=${value}`).join(',');
}

function informerPath(value: InformerDefinition, namespace: string): string {
  const separatorIndex: number = value.path.lastIndexOf('/');
  return `/${value.path.slice(0, separatorIndex)}/namespaces/${namespace}/${value.path.slice(separatorIndex + 1)}`;
}
