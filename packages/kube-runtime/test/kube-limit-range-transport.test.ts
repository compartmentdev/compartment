import { describe, expect, it } from 'vitest';
import {
  projectNamespaceProvisioningBundle,
  type ApplyBundle,
  type KubeManifest,
  type ProjectNamespaceProvisioningRow,
} from '../src';
import type { ProjectProvisioningServiceAccount } from '../src/kube-provisioning.types';
import { applyObject } from '../src/kube-runtime-operations';
import { CapturingKubernetesObjectApi } from './kube-transport-capture.harness';
import type { SerializedLimitRange } from './kube-limit-range-transport.test.types';

const podCidr: string = ['10', '42', '0', '0/16'].join('.');
const serviceCidr: string = ['10', '43', '0', '0/16'].join('.');

const limitRangeUriPath: string = '/api/v1/namespaces/project/limitranges/project-limits';

describe('LimitRange transport', (): void => {
  it('serializes both request and limit defaults onto the Kubernetes wire contract', async (): Promise<void> => {
    const bundle: ApplyBundle = projectNamespaceProvisioningBundle(provisioningRow());
    const limitRange: KubeManifest = bundle.objects.find(
      (manifest: KubeManifest): boolean => manifest.kind === 'LimitRange',
    )!;
    const objectApi: CapturingKubernetesObjectApi = new CapturingKubernetesObjectApi(limitRangeUriPath);

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
