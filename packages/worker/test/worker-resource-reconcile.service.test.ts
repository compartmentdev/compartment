import type { WorkerClaimResourceReconcileResponse } from '@compartment/contracts';
import {
  kubeResourceVolumeName,
  kubeResourceName,
  KubeRuntime,
  type ApplyBundle,
  type KubeManifest,
  type KubeObservation,
  type KubeObservationHealth,
  type KubeObservationEvent,
  type KubeObservedManifest,
} from '@compartment/kube-runtime';
import type { CompartmentRequester } from '@compartment/sdk';
import type * as CompartmentSdk from '@compartment/sdk';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { readCreatedClaims } from '../src/services/worker-resource-reconcile-observation.service';
import { executeResourceReconcile } from '../src/services/worker-resource-reconcile.service';

const dataClaimName: string = kubeResourceVolumeName('resource', 'data');
const backupClaimName: string = kubeResourceVolumeName('resource', 'backup-artifacts');
const resourceName: string = kubeResourceName('resource');

interface ResourceSdkMocks {
  acknowledge: Mock;
}

const mocks: ResourceSdkMocks = vi.hoisted((): ResourceSdkMocks => ({ acknowledge: vi.fn() }));
vi.mock(
  '@compartment/sdk',
  async (loadOriginal: () => Promise<typeof CompartmentSdk>): Promise<typeof CompartmentSdk> => {
    const original: typeof CompartmentSdk = await loadOriginal();
    return { ...original, acknowledgeResourceReconcile: mocks.acknowledge };
  },
);

describe('worker resource reconcile lifecycle', (): void => {
  beforeEach((): void => {
    mocks.acknowledge.mockReset();
  });

  it('rejects substituted PVC UID before mutating a Deployment', async (): Promise<void> => {
    const observation: TestObservation = new TestObservation('uid-substituted', true);
    observation.addClaim(backupClaimName, 'uid-backup', false);
    const apply: Mock = vi.fn();
    await expect(executeResourceReconcile(requester(), runtime(apply, observation), claim())).rejects.toThrow(
      'UID changed',
    );
    expect(apply).not.toHaveBeenCalled();
  });

  it('completes bootstrap after WaitForFirstConsumer claims have stable UIDs but remain pending', async (): Promise<void> => {
    const observation: TestObservation = new TestObservation('uid-created', false, false);
    const apply: Mock = vi.fn(async (bundle: ApplyBundle): Promise<KubeManifest[]> => {
      observation.addClaim(backupClaimName, 'uid-backup', false);
      return await Promise.resolve(bundle.objects);
    });
    expect(readCreatedClaims(observation, 2)).toBeNull();

    await executeResourceReconcile(requester(), runtime(apply, observation), bootstrapClaim());

    expect(apply).toHaveBeenCalledOnce();
    expect(mocks.acknowledge).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        expectedClaims: [
          { claimName: dataClaimName, uid: 'uid-created' },
          { claimName: backupClaimName, uid: 'uid-backup' },
        ],
        status: 'succeeded',
      }),
    );
  });

  it('starts the first workload before requiring a WaitForFirstConsumer claim to bind', async (): Promise<void> => {
    const observation: TestObservation = new TestObservation('uid-original', false, false, false);
    observation.addClaim(backupClaimName, 'uid-backup', false);
    const apply: Mock = vi.fn(async (bundle: ApplyBundle): Promise<KubeManifest[]> => {
      const deployment: KubeManifest | undefined = bundle.objects.find(
        (object: KubeManifest): boolean => object.kind === 'Deployment',
      );
      if (deployment?.kind === 'Deployment' && deployment.spec?.replicas === 1) {
        observation.bindClaims();
        observation.addReadyDeployment();
        observation.addPod('resource-first-pod');
      }
      return await Promise.resolve(bundle.objects);
    });

    await executeResourceReconcile(requester(), runtime(apply, observation), claim(null));

    expect(apply).toHaveBeenCalledTimes(2);
    expect(mocks.acknowledge).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'succeeded' }),
    );
  });

  it('fences PVCs through live reads when the informer initial list is partial', async (): Promise<void> => {
    const observation: TestObservation = new TestObservation('uid-original', false);
    const apply: Mock = vi.fn(async (bundle: ApplyBundle): Promise<KubeManifest[]> => {
      const deployment: KubeManifest | undefined = bundle.objects.find(
        (object: KubeManifest): boolean => object.kind === 'Deployment',
      );
      if (deployment?.kind === 'Deployment' && deployment.spec?.replicas === 1) {
        observation.bindClaims();
        observation.addReadyDeployment();
      }
      return await Promise.resolve(bundle.objects);
    });
    const read: Mock = vi.fn(async (manifest: KubeManifest): Promise<KubeObservedManifest | null> => {
      if (manifest.kind === 'PersistentVolumeClaim' && manifest.metadata?.name === backupClaimName) {
        return liveClaim(backupClaimName, 'uid-backup', false);
      }
      return await readFromObservation(observation, manifest);
    });

    await executeResourceReconcile(requester(), runtime(apply, observation, read), claim(null));

    expect(observation.cache.has(`persistentvolumeclaims/ns/${backupClaimName}`)).toBe(false);
    expect(mocks.acknowledge).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'succeeded' }),
    );
  });

  it('completes from live Deployment state when the informer cache misses readiness updates', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const observation: TestObservation = new TestObservation('uid-original', false);
      observation.addClaim(backupClaimName, 'uid-backup', false);
      let desiredApplied: boolean = false;
      let liveReadyReads: number = 0;
      const apply: Mock = vi.fn(async (bundle: ApplyBundle): Promise<KubeManifest[]> => {
        desiredApplied = bundle.objects.some(
          (object: KubeManifest): boolean => object.kind === 'Deployment' && object.spec?.replicas === 1,
        );
        return await Promise.resolve(bundle.objects);
      });
      const read: Mock = vi.fn(async (manifest: KubeManifest): Promise<KubeObservedManifest | null> => {
        if (manifest.kind === 'Deployment' && desiredApplied) {
          liveReadyReads += 1;
          return liveDeployment(liveReadyReads > 1);
        }
        return await readFromObservation(observation, manifest);
      });

      const execution: Promise<void> = executeResourceReconcile(
        requester(),
        runtime(apply, observation, read),
        claim(null),
      );
      await vi.advanceTimersByTimeAsync(1_000);
      await execution;

      expect(liveReadyReads).toBe(2);
      expect(observation.cache.has('pods/ns/resource-new-pod')).toBe(false);
      expect(mocks.acknowledge).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ status: 'succeeded' }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('scales to zero before starting and rolls back saved executable manifests on apply failure', async (): Promise<void> => {
    const observation: TestObservation = new TestObservation('uid-original', true);
    observation.addClaim(backupClaimName, 'uid-backup', false);
    const bundles: ApplyBundle[] = [];
    const apply: Mock = vi.fn(async (bundle: ApplyBundle): Promise<KubeManifest[]> => {
      bundles.push(bundle);
      const deployment: KubeManifest | undefined = bundle.objects.find(
        (object: KubeManifest): boolean => object.kind === 'Deployment',
      );
      if (deployment?.kind === 'Deployment' && deployment.spec?.replicas === 0) {
        observation.removePods();
        return await Promise.resolve(bundle.objects);
      }
      if (apply.mock.calls.length === 2) {
        throw new Error('new image failed');
      }
      observation.addPod('resource-rollback-pod');
      return await Promise.resolve(bundle.objects);
    });
    await expect(executeResourceReconcile(requester(), runtime(apply, observation), claim(null))).rejects.toThrow(
      'new image failed',
    );
    const stopped: KubeManifest | undefined = bundles[0]?.objects.find(
      (object: KubeManifest): boolean => object.kind === 'Deployment',
    );
    expect(stopped?.kind === 'Deployment' ? stopped.spec?.replicas : undefined).toBe(0);
    expect(apply).toHaveBeenCalledTimes(4);
    const rollbackJson: string = JSON.stringify(bundles[3]?.objects);
    expect(rollbackJson).toContain('postgres:16');
    expect(rollbackJson).not.toContain('resourceVersion');
    expect(rollbackJson).not.toContain('managedFields');
    expect(rollbackJson).not.toContain('"status"');
    expect(mocks.acknowledge).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ leaseId: 'lease-1', operationId: 'operation-1', status: 'running' }),
    );
    expect(mocks.acknowledge).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ leaseId: 'lease-1', status: 'failed' }),
    );
  });
});

class TestObservation implements KubeObservation {
  public readonly cache: Map<string, KubeObservedManifest> = new Map<string, KubeObservedManifest>();
  public constructor(uid: string, withPod: boolean, bound: boolean = true, withDeployment: boolean = true) {
    this.cache.set(`persistentvolumeclaims/ns/${dataClaimName}`, {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: { name: dataClaimName, uid },
      status: { phase: bound ? 'Bound' : 'Pending' },
    });
    this.cache.set(`deployments/ns/${resourceName}`, {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        annotations: { 'compartment.dev/revision': 'old' },
        creationTimestamp: new Date('2026-07-12T00:00:00Z'),
        labels: { 'compartment.dev/resource-id': 'resource' },
        generation: 1,
        managedFields: [{ manager: 'kube-controller-manager' }],
        name: resourceName,
        namespace: 'cpt-project',
        resourceVersion: '42',
        uid: 'deployment-uid',
      },
      spec: {
        progressDeadlineSeconds: 90,
        replicas: 1,
        selector: { matchLabels: { 'compartment.dev/resource-id': 'resource' } },
        strategy: { type: 'Recreate' },
        template: {
          metadata: { labels: { 'compartment.dev/resource-id': 'resource' } },
          spec: {
            automountServiceAccountToken: false,
            containers: [{ env: [], image: 'postgres:16', name: 'resource' }],
          },
        },
      },
      status: {
        conditions: [{ status: 'True', type: 'Available' }],
        observedGeneration: 1,
        readyReplicas: 1,
      },
    });
    this.cache.set('secrets/ns/resource', {
      apiVersion: 'v1',
      data: { PASSWORD: 'old' },
      kind: 'Secret',
      metadata: { name: 'resource', namespace: 'cpt-project', resourceVersion: '43' },
      status: { ignored: true },
    } as KubeObservedManifest);
    this.cache.set('services/ns/resource', {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: 'resource', namespace: 'cpt-project', uid: 'service-uid' },
      spec: {
        ports: [{ name: 'resource', port: 5432, protocol: 'TCP', targetPort: 5432 }],
        selector: { 'compartment.dev/resource-id': 'resource' },
      },
      status: { loadBalancer: {} },
    });
    if (!withDeployment) {
      this.cache.delete('deployments/ns/resource');
    }
    if (withPod) {
      this.cache.set('pods/ns/resource-pod', { metadata: { name: 'resource-pod' } } as KubeObservedManifest);
    }
  }
  public health(): KubeObservationHealth {
    return { healthy: true, lastConnectedAt: new Date(), lastErrorAt: null };
  }
  public onEvent(listener: (event: KubeObservationEvent) => Promise<void> | void): () => void {
    void listener;
    return (): void => undefined;
  }
  public async stop(): Promise<void> {
    await Promise.resolve();
  }
  public removePods(): void {
    this.cache.delete('pods/ns/resource-pod');
  }
  public addPod(name: string): void {
    this.cache.set(`pods/ns/${name}`, { metadata: { name } } as KubeObservedManifest);
  }
  public addReadyDeployment(): void {
    this.cache.set(`deployments/ns/${resourceName}`, {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { generation: 1, name: resourceName },
      spec: { replicas: 1 },
      status: {
        conditions: [{ status: 'True', type: 'Available' }],
        observedGeneration: 1,
        readyReplicas: 1,
      },
    } as KubeObservedManifest);
  }
  public addClaim(name: string, uid: string, bound: boolean): void {
    this.cache.set(`persistentvolumeclaims/ns/${name}`, {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: { name, uid },
      status: { phase: bound ? 'Bound' : 'Pending' },
    });
  }
  public bindClaims(): void {
    const observedClaim: KubeObservedManifest | undefined = this.cache.get(
      `persistentvolumeclaims/ns/${dataClaimName}`,
    );
    if (observedClaim !== undefined) {
      observedClaim.status = { phase: 'Bound' };
    }
  }
}

function runtime(apply: Mock, observation: KubeObservation, read?: Mock): KubeRuntime {
  const value: KubeRuntime = Object.create(KubeRuntime.prototype) as KubeRuntime;
  vi.spyOn(value, 'apply').mockImplementation(apply);
  vi.spyOn(value, 'observe').mockResolvedValue(observation);
  vi.spyOn(value, 'read').mockImplementation(
    read ??
      (async (manifest: KubeManifest): Promise<KubeObservedManifest | null> =>
        await readFromObservation(observation, manifest)),
  );
  return value;
}

async function readFromObservation(
  observation: KubeObservation,
  manifest: KubeManifest,
): Promise<KubeObservedManifest | null> {
  return await Promise.resolve(
    [...observation.cache.values()].find(
      (observed: KubeObservedManifest): boolean =>
        observed.kind === manifest.kind &&
        (manifest.metadata?.name === undefined || observed.metadata?.name === manifest.metadata.name),
    ) ?? null,
  );
}

function liveClaim(name: string, uid: string, bound: boolean): KubeObservedManifest {
  return {
    apiVersion: 'v1',
    kind: 'PersistentVolumeClaim',
    metadata: { name, uid },
    status: { phase: bound ? 'Bound' : 'Pending' },
  };
}

function liveDeployment(ready: boolean): KubeObservedManifest {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { generation: 2, name: resourceName, namespace: 'cpt-project' },
    spec: { replicas: 1 },
    status: {
      conditions: [{ status: ready ? 'True' : 'False', type: 'Available' }],
      observedGeneration: ready ? 2 : 1,
      readyReplicas: ready ? 1 : 0,
    },
  } as KubeObservedManifest;
}

function requester(): CompartmentRequester {
  return vi.fn() as CompartmentRequester;
}

function claim(
  previousManifestJson:
    | string
    | null = '[{"apiVersion":"apps/v1","kind":"Deployment","metadata":{"name":"old"},"spec":{"replicas":1}}]',
): WorkerClaimResourceReconcileResponse {
  return {
    expectedClaims: [
      { claimName: dataClaimName, uid: 'uid-original' },
      { claimName: backupClaimName, uid: 'uid-backup' },
    ],
    intent: {
      containerPort: 5432,
      environmentId: 'env',
      env: {},
      image: 'postgres:17',
      namespaceId: 'project',
      resourceId: 'resource',
      secretId: 'secret',
      volumes: [{ mountPath: '/data', size: '1Gi', volumeHandle: 'data' }],
    },
    leaseId: 'lease-1',
    operationId: 'operation-1',
    previousManifestJson,
    type: 'reconcile',
  };
}

function bootstrapClaim(): WorkerClaimResourceReconcileResponse {
  return {
    ...claim(null),
    expectedClaims: [],
    type: 'bootstrap',
  };
}
