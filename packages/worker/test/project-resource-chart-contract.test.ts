import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import {
  KubernetesObjectApi,
  RequestContext,
  type HttpMethod,
  type KubernetesObject,
  type RequestBody,
} from '@kubernetes/client-node';
import {
  KubeRuntime,
  kubeNamespaceName,
  projectNamespaceProvisioningBundle,
  type KubeManifest,
  type ProjectNamespaceProvisioningRow,
} from '@compartment/kube-runtime';
import { describe, expect, it } from 'vitest';
import { parseAllDocuments, type Document } from 'yaml';
import { readProjectContainerDefaults, readProjectQuota } from '../src/resource-quota-config';

interface RenderedConfigMap {
  data?: Record<string, string>;
  kind?: string;
}

const executeFile = promisify(execFile);
const chartDirectory: string = resolve(__dirname, '../../../deploy/chart/compartment');
const podCidr: string = ['10', '42', '0', '0/16'].join('.');
const serviceCidr: string = ['10', '43', '0', '0/16'].join('.');
const projectId: string = 'prj_contract';

describe('shipped project resource contract', (): void => {
  it('reaches Kubernetes from chart values through the worker parser and projection', async (): Promise<void> => {
    const { stdout } = await executeFile('helm', ['template', 'project-resource-contract', chartDirectory]);
    const configMap: RenderedConfigMap | undefined = parseAllDocuments(stdout)
      .map((document: Document): RenderedConfigMap => document.toJSON() as RenderedConfigMap)
      .find((document: RenderedConfigMap): boolean => document.kind === 'ConfigMap' && document.data !== undefined);
    const defaultsJson: string = requiredConfigValue(configMap, 'COMPARTMENT_PROJECT_CONTAINER_DEFAULTS');
    const quotaJson: string = requiredConfigValue(configMap, 'COMPARTMENT_PROJECT_QUOTA');
    const api = new CapturingKubernetesObjectApi();
    const runtime: KubeRuntime = new KubeRuntime({ makeApiClient: (): KubernetesObjectApi => api } as never);

    const bundle = projectNamespaceProvisioningBundle(provisioningRow(), {
      containerDefaults: readProjectContainerDefaults(defaultsJson, 'COMPARTMENT_PROJECT_CONTAINER_DEFAULTS'),
      quota: readProjectQuota(quotaJson, 'COMPARTMENT_PROJECT_QUOTA'),
    });
    await runtime.apply({ objects: bundle.objects });

    const limitRange: KubeManifest = requiredManifest(api.objects, 'LimitRange');
    const resourceQuota: KubeManifest = requiredManifest(api.objects, 'ResourceQuota');
    expect(limitRange).toMatchObject({
      apiVersion: 'v1',
      kind: 'LimitRange',
      metadata: {
        labels: {
          'app.kubernetes.io/managed-by': 'compartment',
          'compartment.dev/namespace-id': projectId,
          'compartment.dev/project-id': projectId,
        },
        namespace: kubeNamespaceName(projectId),
      },
      spec: {
        limits: [
          {
            default: { cpu: '1', memory: '512Mi' },
            defaultRequest: { cpu: '50m', memory: '512Mi' },
            type: 'Container',
          },
        ],
      },
    });
    expect(limitRange.metadata?.name).toMatch(/^limits-prj-contract-/u);
    expect(resourceQuota).toMatchObject({
      apiVersion: 'v1',
      kind: 'ResourceQuota',
      metadata: {
        labels: {
          'app.kubernetes.io/managed-by': 'compartment',
          'compartment.dev/namespace-id': projectId,
          'compartment.dev/project-id': projectId,
        },
        namespace: kubeNamespaceName(projectId),
      },
      spec: {
        hard: {
          'count/configmaps': '100',
          'count/deployments.apps': '50',
          'count/jobs.batch': '100',
          'count/networkpolicies.networking.k8s.io': '20',
          'count/persistentvolumeclaims': '20',
          'count/secrets': '100',
          'count/serviceaccounts': '10',
          'count/services': '50',
          'limits.cpu': '8',
          'limits.memory': '8Gi',
          pods: '50',
          'requests.cpu': '2',
          'requests.memory': '8Gi',
          'requests.storage': '20Gi',
        },
      },
    });
    expect(resourceQuota.metadata?.name).toMatch(/^quota-prj-contract-/u);
  });
});

class CapturingKubernetesObjectApi extends KubernetesObjectApi {
  public readonly objects: KubeManifest[] = [];

  public constructor() {
    super({
      baseServer: {
        makeRequestContext: (path: string, method: HttpMethod): RequestContext =>
          new RequestContext(`https://kubernetes.test${path}`, method),
      },
    } as never);
  }

  protected override async specUriPath(): Promise<string> {
    return await Promise.resolve('/api/v1/namespaces/project/manifests/name');
  }

  protected override async requestPromise<T extends KubernetesObject>(requestContext: RequestContext): Promise<T> {
    const body: RequestBody = requestContext.getBody();
    if (typeof body !== 'string') {
      throw new Error('Expected the Kubernetes request body to be serialized JSON.');
    }
    const object: KubeManifest = JSON.parse(body) as KubeManifest;
    this.objects.push(object);
    return await Promise.resolve(object as T);
  }
}

function requiredConfigValue(configMap: RenderedConfigMap | undefined, name: string): string {
  const value: string | undefined = configMap?.data?.[name];
  if (value === undefined) {
    throw new Error(`Rendered chart ConfigMap is missing ${name}.`);
  }
  return value;
}

function requiredManifest(objects: KubeManifest[], kind: string): KubeManifest {
  const object: KubeManifest | undefined = objects.find((candidate: KubeManifest): boolean => candidate.kind === kind);
  if (object === undefined) {
    throw new Error(`Kubernetes transport did not receive ${kind}.`);
  }
  return object;
}

function provisioningRow(): ProjectNamespaceProvisioningRow {
  return {
    bootstrapServiceAccount: { name: 'bootstrap', namespace: 'platform' },
    installationId: 'inst_contract',
    namespaceId: projectId,
    networkPolicy: {
      applicationPodLabels: { app: 'application' },
      applicationPorts: [],
      edgeNamespaceName: 'edge',
      edgePodLabels: { app: 'edge' },
      podCidr,
      resourcePodLabels: { app: 'resource' },
      resourcePorts: [],
      serviceCidr,
    },
    organizationId: 'org_contract',
    projectId,
    projectName: 'contract',
    registryPullCredentials: { dockerConfigJson: '{"auths":{}}', secretId: projectId },
    workerServiceAccount: { name: 'worker', namespace: 'platform' },
  };
}
