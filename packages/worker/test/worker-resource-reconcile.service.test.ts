import type { WorkerClaimResourceReconcileResponse } from '@compartment/contracts';
import {
  kubeResourceVolumeName,
  kubeResourceName,
  kubeSecretName,
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
      const applied: KubeManifest[] = withAppliedDeploymentIdentity(bundle.objects, 2);
      const deployment: KubeManifest | undefined = applied.find(
        (object: KubeManifest): boolean => object.kind === 'Deployment',
      );
      if (deployment?.kind === 'Deployment' && deployment.spec?.replicas === 1) {
        observation.bindClaims();
        observation.addReadyDeployment(deployment, 2);
        observation.addPod('resource-first-pod');
      }
      return await Promise.resolve(applied);
    });

    await executeResourceReconcile(requester(), runtime(apply, observation), claim(null));

    expect(apply).toHaveBeenCalledTimes(2);
    expect(mocks.acknowledge).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'succeeded' }),
    );
  });

  it('fails closed when the observed PVC snapshot is incomplete', async (): Promise<void> => {
    const observation: TestObservation = new TestObservation('uid-original', false);
    const apply: Mock = vi.fn();
    const read: Mock = vi.fn();
    const kubeRuntime: KubeRuntime = runtime(apply, observation, read);

    await expect(executeResourceReconcile(requester(), kubeRuntime, claim(null))).rejects.toThrow('is missing');

    expect(observation.cache.has(`persistentvolumeclaims/ns/${backupClaimName}`)).toBe(false);
    expect(read).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it('uses the shared observation snapshot without polling Kubernetes reads', async (): Promise<void> => {
    const observation: TestObservation = new TestObservation('uid-original', false);
    observation.addClaim(backupClaimName, 'uid-backup', false);
    const apply: Mock = vi.fn(async (bundle: ApplyBundle): Promise<KubeManifest[]> => {
      const applied: KubeManifest[] = withAppliedDeploymentIdentity(bundle.objects, 2);
      const deployment: KubeManifest | undefined = applied.find(
        (object: KubeManifest): boolean => object.kind === 'Deployment',
      );
      if (deployment?.kind === 'Deployment' && deployment.spec?.replicas === 1) {
        observation.addReadyDeployment(deployment, 2);
      }
      return await Promise.resolve(applied);
    });
    const read: Mock = vi.fn();
    const kubeRuntime: KubeRuntime = runtime(apply, observation, read);

    await executeResourceReconcile(requester(), kubeRuntime, claim(null));

    expect(read).not.toHaveBeenCalled();
    expect(mocks.acknowledge).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'succeeded' }),
    );
  });

  it('waits for the applied Deployment generation instead of accepting stale cached readiness', async (): Promise<void> => {
    const observation: TestObservation = new TestObservation('uid-original', true);
    observation.addClaim(backupClaimName, 'uid-backup', false);
    let appliedDeployment: KubeManifest | null = null;
    const apply: Mock = vi.fn(async (bundle: ApplyBundle): Promise<KubeManifest[]> => {
      const deployment: KubeManifest | undefined = bundle.objects.find(
        (object: KubeManifest): boolean => object.kind === 'Deployment',
      );
      if (deployment?.kind === 'Deployment' && deployment.spec?.replicas === 0) {
        observation.removePods();
        return await Promise.resolve(bundle.objects);
      }
      const applied: KubeManifest[] = bundle.objects.map((object: KubeManifest): KubeManifest => {
        if (object.kind !== 'Deployment') {
          return object;
        }
        return { ...object, metadata: { ...object.metadata, generation: 2, uid: 'deployment-uid' } };
      });
      appliedDeployment = applied.find((object: KubeManifest): boolean => object.kind === 'Deployment') ?? null;
      return await Promise.resolve(applied);
    });

    const execution: Promise<void> = executeResourceReconcile(requester(), runtime(apply, observation), claim(null));
    await vi.waitFor((): void => {
      expect(apply).toHaveBeenCalledTimes(2);
    });
    expect(mocks.acknowledge).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'succeeded' }),
    );

    expect(appliedDeployment).not.toBeNull();
    observation.addReadyDeployment(appliedDeployment!, 2);
    await execution;

    expect(mocks.acknowledge).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'succeeded' }),
    );
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
      const applied: KubeManifest[] = withAppliedDeploymentIdentity(bundle.objects, 2);
      if (apply.mock.calls.length === 4) {
        const rollbackDeployment: KubeManifest | undefined = applied.find(
          (object: KubeManifest): boolean => object.kind === 'Deployment',
        );
        if (rollbackDeployment !== undefined) {
          observation.addReadyDeployment(rollbackDeployment, 2);
        }
        observation.addPod('resource-rollback-pod');
      }
      return await Promise.resolve(applied);
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

  it('refuses a live managed update without a complete rollback snapshot before scaling down', async (): Promise<void> => {
    const observation: TestObservation = new TestObservation('uid-original', true, true, false);
    observation.addClaim(backupClaimName, 'uid-backup', false);
    const apply: Mock = vi.fn();

    await expect(executeResourceReconcile(requester(), runtime(apply, observation), claim(null))).rejects.toThrow(
      'complete rollback snapshot',
    );

    expect(apply).not.toHaveBeenCalled();
    expect(observation.cache.has('pods/ns/resource-pod')).toBe(true);
    expect(mocks.acknowledge).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('stops the workload before deleting manifests and explicitly requested data', async (): Promise<void> => {
    const observation: TestObservation = new TestObservation('uid-original', true);
    observation.addClaim(backupClaimName, 'uid-backup', false);
    const apply: Mock = vi.fn(async (bundle: ApplyBundle): Promise<KubeManifest[]> => {
      observation.removePods();
      return await Promise.resolve(bundle.objects);
    });
    const removed: KubeManifest[][] = [];
    const remove: Mock = vi.fn(async (objects: KubeManifest[]): Promise<void> => {
      removed.push(objects);
      await Promise.resolve();
    });

    await executeResourceReconcile(requester(), runtime(apply, observation, undefined, remove), deleteClaim());

    expect(remove).toHaveBeenCalledTimes(2);
    expect(removed[0]?.map((object: KubeManifest): string => object.kind)).toEqual(['Secret', 'Deployment', 'Service']);
    expect(removed[1]).toHaveLength(2);
    expect(mocks.acknowledge).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'succeeded' }),
    );
  });

  it('refuses to delete a replacement PVC created while the workload terminates', async (): Promise<void> => {
    const observation: TestObservation = new TestObservation('uid-original', true);
    observation.addClaim(backupClaimName, 'uid-backup', false);
    const apply: Mock = vi.fn(async (bundle: ApplyBundle): Promise<KubeManifest[]> => {
      observation.removePods();
      observation.addClaim(dataClaimName, 'uid-replacement', true);
      return await Promise.resolve(bundle.objects);
    });
    const remove: Mock = vi.fn();

    await expect(
      executeResourceReconcile(requester(), runtime(apply, observation, undefined, remove), deleteClaim()),
    ).rejects.toThrow('UID changed');

    expect(remove).not.toHaveBeenCalled();
    expect(mocks.acknowledge).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'failed' }),
    );
  });
});

class TestObservation implements KubeObservation {
  public readonly cache: Map<string, KubeObservedManifest> = new Map<string, KubeObservedManifest>();
  private readonly listeners: Set<(event: KubeObservationEvent) => Promise<void> | void> = new Set<
    (event: KubeObservationEvent) => Promise<void> | void
  >();
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
        availableReplicas: 1,
        conditions: [{ status: 'True', type: 'Available' }],
        observedGeneration: 1,
        readyReplicas: 1,
      },
    });
    this.cache.set(`secrets/ns/${kubeSecretName('secret')}`, {
      apiVersion: 'v1',
      data: { PASSWORD: 'old' },
      kind: 'Secret',
      metadata: { name: kubeSecretName('secret'), namespace: 'cpt-project', resourceVersion: '43' },
      status: { ignored: true },
    } as KubeObservedManifest);
    this.cache.set(`services/ns/${resourceName}`, {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: resourceName, namespace: 'cpt-project', uid: 'service-uid' },
      spec: {
        ports: [{ name: 'resource', port: 5432, protocol: 'TCP', targetPort: 5432 }],
        selector: { 'compartment.dev/resource-id': 'resource' },
      },
      status: { loadBalancer: {} },
    });
    if (!withDeployment) {
      this.cache.delete(`deployments/ns/${resourceName}`);
    }
    if (withPod) {
      this.cache.set('pods/ns/resource-pod', { metadata: { name: 'resource-pod' } } as KubeObservedManifest);
    }
  }
  public health(): KubeObservationHealth {
    return { healthy: true, lastConnectedAt: new Date(), lastErrorAt: null };
  }
  public onEvent(listener: (event: KubeObservationEvent) => Promise<void> | void): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
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
  public addReadyDeployment(deployment: KubeManifest, observedGeneration?: number): void {
    if (deployment.kind !== 'Deployment') {
      throw new Error('Expected a Deployment manifest.');
    }
    const observed: KubeObservedManifest = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { ...deployment.metadata, name: resourceName },
      spec: deployment.spec,
      status: {
        availableReplicas: 1,
        conditions: [{ status: 'True', type: 'Available' }],
        ...(observedGeneration === undefined ? {} : { observedGeneration }),
        readyReplicas: 1,
      },
    };
    this.cache.set(`deployments/ns/${resourceName}`, observed);
    this.listeners.forEach((listener: (event: KubeObservationEvent) => Promise<void> | void): void => {
      void listener({ object: observed, observedAt: new Date(), resource: 'deployments', type: 'update' });
    });
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

function runtime(apply: Mock, observation: KubeObservation, read?: Mock, remove?: Mock): KubeRuntime {
  const value: KubeRuntime = Object.create(KubeRuntime.prototype) as KubeRuntime;
  vi.spyOn(value, 'apply').mockImplementation(apply);
  vi.spyOn(value, 'delete').mockImplementation(remove ?? vi.fn());
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
      deleteData: false,
      environmentId: 'env',
      env: {},
      image: 'postgres:17',
      namespaceId: 'project',
      operation: 'reconcile',
      replicas: 1,
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

function deleteClaim(): WorkerClaimResourceReconcileResponse {
  const claimed: WorkerClaimResourceReconcileResponse = claim(null);
  return {
    ...claimed,
    intent: claimed.intent === null ? null : { ...claimed.intent, deleteData: true, operation: 'delete', replicas: 0 },
  };
}

function withAppliedDeploymentIdentity(objects: KubeManifest[], generation: number): KubeManifest[] {
  return objects.map(
    (object: KubeManifest): KubeManifest =>
      object.kind === 'Deployment'
        ? { ...object, metadata: { ...object.metadata, generation, uid: 'deployment-uid' } }
        : object,
  );
}
