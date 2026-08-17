import type { ResourceReconcileIntent } from '@compartment/contracts';
import {
  kubeResourceVolumeName,
  KubeRuntime,
  type KubeManifest,
  type KubeObservation,
  type KubeObservedManifest,
  type ResourceProjectionRow,
} from '@compartment/kube-runtime';
import type { CompartmentRequester } from '@compartment/sdk';
import type * as CompartmentSdk from '@compartment/sdk';
import { afterEach, expect, it, vi, type Mock } from 'vitest';
import { executeManagedDelete } from '../src/services/worker-resource-delete.service';
import type { CompleteResourceReconcileClaim } from '../src/services/worker-resource-reconcile.service.types';
import { resourceReconcileRequestError } from './resource-reconcile-request-error.fixture';

const acknowledge: Mock = vi.hoisted((): Mock => vi.fn());
const dataClaimName: string = kubeResourceVolumeName('resource', 'data');
const backupClaimName: string = kubeResourceVolumeName('resource', 'backup-artifacts');

vi.mock(
  '@compartment/sdk',
  async (loadOriginal: () => Promise<typeof CompartmentSdk>): Promise<typeof CompartmentSdk> => {
    const original: typeof CompartmentSdk = await loadOriginal();
    return { ...original, acknowledgeResourceReconcile: acknowledge };
  },
);

interface DeleteObservationHealth {
  healthy: boolean;
  lastConnectedAt: Date;
  lastErrorAt: null;
}

afterEach((): void => {
  vi.useRealTimers();
  acknowledge.mockReset();
});

it('does not delete managed objects after losing the reconcile lease during termination', async (): Promise<void> => {
  vi.useFakeTimers();
  acknowledge.mockResolvedValueOnce({}).mockRejectedValueOnce(resourceReconcileRequestError(409));
  const observation: DeleteObservation = new DeleteObservation();
  const apply: Mock = vi.fn();
  const remove: Mock = vi.fn();
  const runtime: KubeRuntime = deleteRuntime(apply, remove);
  const execution: Promise<void> = executeManagedDelete(
    vi.fn() as CompartmentRequester,
    runtime,
    observation,
    claimedDelete(),
    deleteRow(),
  );
  const rejected: Promise<void> = expect(execution).rejects.toThrow('lease is no longer current');
  await vi.waitFor((): void => expect(apply).toHaveBeenCalledOnce());

  await vi.advanceTimersByTimeAsync(60_000);
  await rejected;
  expect(remove).not.toHaveBeenCalled();
  expect(acknowledge).toHaveBeenCalledTimes(2);
});

class DeleteObservation implements KubeObservation {
  public readonly cache: Map<string, KubeObservedManifest> = new Map<string, KubeObservedManifest>([
    ['pods/ns/resource-pod', { apiVersion: 'v1', kind: 'Pod', metadata: { name: 'resource-pod' } }],
  ]);
  public health(): DeleteObservationHealth {
    return { healthy: true, lastConnectedAt: new Date(), lastErrorAt: null };
  }
  public onEvent(): () => void {
    return (): void => undefined;
  }
  public async stop(): Promise<void> {
    await Promise.resolve();
  }
}

function deleteRuntime(apply: Mock, remove: Mock): KubeRuntime {
  const runtime: KubeRuntime = Object.create(KubeRuntime.prototype) as KubeRuntime;
  vi.spyOn(runtime, 'apply').mockImplementation(async (bundle): Promise<KubeManifest[]> => {
    apply(bundle);
    return await Promise.resolve(bundle.objects);
  });
  vi.spyOn(runtime, 'delete').mockImplementation(async (objects: KubeManifest[]): Promise<void> => {
    remove(objects);
    await Promise.resolve();
  });
  vi.spyOn(runtime, 'read').mockImplementation(
    async (manifest: KubeManifest): Promise<KubeObservedManifest | null> =>
      await Promise.resolve(observedClaim(manifest.metadata?.name)),
  );
  return runtime;
}

function observedClaim(name: string | undefined): KubeObservedManifest | null {
  if (name !== dataClaimName && name !== backupClaimName) {
    return null;
  }
  return {
    apiVersion: 'v1',
    kind: 'PersistentVolumeClaim',
    metadata: { name, resourceVersion: `${name}-rv`, uid: `${name}-uid` },
    status: { phase: name === dataClaimName ? 'Bound' : 'Pending' },
  };
}

function claimedDelete(): CompleteResourceReconcileClaim {
  const intent: ResourceReconcileIntent = { ...deleteRow(), env: {} };
  return {
    expectedClaims: [
      { claimName: dataClaimName, uid: `${dataClaimName}-uid` },
      { claimName: backupClaimName, uid: `${backupClaimName}-uid` },
    ],
    intent,
    leaseId: 'lease-1',
    networkPolicy: { applicationPorts: [], resourcePorts: [] },
    operationId: 'operation-1',
    previousManifestJson: null,
    type: 'reconcile',
  };
}

function deleteRow(): ResourceProjectionRow {
  return {
    command: [],
    dataScheduling: {
      nodeSelector: { 'compartment.dev/node-pool': 'data' },
      runtimeClassName: 'gvisor',
      tolerations: [],
    },
    deleteData: true,
    environmentId: 'environment',
    env: {},
    image: 'postgres:17',
    namespaceId: 'project',
    operation: 'delete',
    ports: [5432],
    readiness: null,
    replicas: 0,
    resourceId: 'resource',
    secretId: 'secret',
    volumes: [{ mountPath: '/data', size: '1Gi', volumeHandle: 'data' }],
  };
}
