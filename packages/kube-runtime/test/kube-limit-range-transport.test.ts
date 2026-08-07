import {
  KubernetesObjectApi,
  RequestContext,
  type HttpMethod,
  type KubernetesObject,
  type RequestBody,
} from '@kubernetes/client-node';
import { describe, expect, it } from 'vitest';
import {
  projectNamespaceProvisioningBundle,
  type ApplyBundle,
  type KubeManifest,
  type ProjectNamespaceProvisioningRow,
} from '../src';
import type { ProjectProvisioningServiceAccount } from '../src/kube-provisioning.types';
import { applyObject } from '../src/kube-runtime-operations';

interface SerializedLimitRange {
  spec: {
    limits: {
      default: Record<string, string>;
      defaultRequest: Record<string, string>;
      _default?: Record<string, string> | undefined;
    }[];
  };
}

const podCidr: string = ['10', '42', '0', '0/16'].join('.');
const serviceCidr: string = ['10', '43', '0', '0/16'].join('.');

class CapturingKubernetesObjectApi extends KubernetesObjectApi {
  public body: string | null = null;

  public constructor() {
    super({
      baseServer: {
        makeRequestContext: (path: string, method: HttpMethod): RequestContext =>
          new RequestContext(`https://kubernetes.test${path}`, method),
      },
    } as never);
  }

  protected override async specUriPath(): Promise<string> {
    return await Promise.resolve('/api/v1/namespaces/project/limitranges/project-limits');
  }

  protected override async requestPromise<T extends KubernetesObject>(requestContext: RequestContext): Promise<T> {
    const body: RequestBody = requestContext.getBody();
    if (typeof body !== 'string') {
      throw new Error('Expected the Kubernetes request body to be serialized JSON.');
    }
    this.body = body;
    return await Promise.resolve(JSON.parse(body) as T);
  }
}

describe('LimitRange transport', (): void => {
  it('serializes both request and limit defaults onto the Kubernetes wire contract', async (): Promise<void> => {
    const bundle: ApplyBundle = projectNamespaceProvisioningBundle(provisioningRow());
    const limitRange: KubeManifest = bundle.objects.find(
      (manifest: KubeManifest): boolean => manifest.kind === 'LimitRange',
    )!;
    const objectApi: CapturingKubernetesObjectApi = new CapturingKubernetesObjectApi();

    await applyObject(objectApi, limitRange, false);

    const serialized: SerializedLimitRange = JSON.parse(objectApi.body ?? '{}') as SerializedLimitRange;
    expect(serialized.spec.limits[0]).toEqual({
      default: { cpu: '1', memory: '1Gi' },
      defaultRequest: { cpu: '50m', memory: '128Mi' },
      type: 'Container',
    });
    expect(serialized.spec.limits[0]).not.toHaveProperty('_default');
  });
});

function provisioningRow(): ProjectNamespaceProvisioningRow {
  const serviceAccount: ProjectProvisioningServiceAccount = { name: 'worker', namespace: 'platform' };
  return {
    bootstrapServiceAccount: { name: 'bootstrap', namespace: 'platform' },
    installationId: 'inst_1',
    namespaceId: 'project',
    networkPolicy: {
      applicationPodLabels: { app: 'application' },
      applicationPorts: [3000],
      edgeNamespaceName: 'edge',
      edgePodLabels: { app: 'edge' },
      podCidr,
      resourcePodLabels: { app: 'resource' },
      resourcePorts: [5432],
      serviceCidr,
    },
    organizationId: 'org_1',
    projectId: 'project',
    projectName: 'payments',
    registryPullCredentials: { dockerConfigJson: '{}', secretId: 'pull-secret' },
    workerServiceAccount: serviceAccount,
  };
}
