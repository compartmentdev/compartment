import {
  resourceReconcileLeaseHeartbeatIntervalMs,
  type WorkerClaimResourceReconcileResponse,
} from '@compartment/contracts';
import {
  kubeResourceVolumeName,
  KubeRuntime,
  type ApplyBundle,
  type KubeDeploymentManifest,
  type KubeManifest,
  type KubeObservation,
  type KubeObservedManifest,
  type KubeWorkloadScheduling,
} from '@compartment/kube-runtime';
import type { CompartmentRequester } from '@compartment/sdk';
import type * as CompartmentSdk from '@compartment/sdk';
import { immutableKubeName } from '@compartment/utils';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { readCreatedClaims } from '../src/services/worker-resource-reconcile-observation.service';
import { executeResourceReconcile as executeResourceReconcileWithKek } from '../src/services/worker-resource-reconcile.service';
import { testTenantSecretsKek } from './tenant-secret-test.fixtures';
import { resourceReconcileRequestError } from './resource-reconcile-request-error.fixture';

const dataClaimName: string = kubeResourceVolumeName('resource', 'data');
const backupClaimName: string = kubeResourceVolumeName('resource', 'backup-artifacts');
const resourceName: string = immutableKubeName('resource', 'resource');
const secretName: string = immutableKubeName('secret', 'secret');
const infrastructureTimeoutMs: number = 10 * 60_000;

type TestObservedResource =
  | 'deployments'
  | 'services'
  | 'networkpolicies'
  | 'persistentvolumeclaims'
  | 'secrets'
  | 'jobs'
  | 'pods';

interface TestKubeObjectObservationEvent {
  object: KubeObservedManifest;
  observedAt: Date;
  resource: TestObservedResource;
  type: 'add' | 'update' | 'delete';
}

interface TestKubeRelistObservationEvent {
  observedAt: Date;
  resource: TestObservedResource;
  type: 'relist';
}

type TestKubeObservationEvent = TestKubeObjectObservationEvent | TestKubeRelistObservationEvent;
type TestKubeObservationListener = (event: TestKubeObservationEvent) => Promise<void> | void;

interface TestKubeObservationHealth {
  healthy: boolean;
  lastConnectedAt: Date | null;
  lastErrorAt: Date | null;
}

interface ResourceSdkMocks {
  acknowledge: Mock;
  applyNetworkPolicy: Mock;
}

async function executeResourceReconcile(
  request: CompartmentRequester,
  kubeRuntime: KubeRuntime,
  claimed: WorkerClaimResourceReconcileResponse,
  scheduling?: KubeWorkloadScheduling,
): Promise<void> {
  return await executeResourceReconcileWithKek(
    request,
    kubeRuntime,
    claimed,
    testTenantSecretsKek,
    infrastructureTimeoutMs,
    scheduling,
  );
}

const mocks: ResourceSdkMocks = vi.hoisted(
  (): ResourceSdkMocks => ({
    acknowledge: vi.fn(),
    applyNetworkPolicy: vi.fn(),
  }),
);
vi.mock('../src/services/worker-network-policy.service', (): object => ({
  applyProjectNetworkPolicies: mocks.applyNetworkPolicy,
}));
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
    mocks.acknowledge.mockResolvedValue({});
    mocks.applyNetworkPolicy.mockReset();
    mocks.applyNetworkPolicy.mockResolvedValue(undefined);
  });

  it('rejects substituted PVC UID before mutating a Deployment', async (): Promise<void> => {
    const observation: TestObservation = new TestObservation('uid-substituted', false, true, false);
    observation.addClaim(backupClaimName, 'uid-backup', false);
    const apply: Mock = vi.fn();
    await expect(executeResourceReconcile(requester(), runtime(apply, observation), claim(null))).rejects.toThrow(
      'UID changed',
    );
    expect(apply).not.toHaveBeenCalled();
  });

  it('does not roll back or acknowledge failure after losing the reconcile lease', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const observation: TestObservation = new TestObservation('uid-original', false, true, false);
      observation.addClaim(backupClaimName, 'uid-backup', false);
      const apply: Mock = vi.fn(
        async (bundle: ApplyBundle): Promise<KubeManifest[]> =>
          await Promise.resolve(withAppliedDeploymentIdentity(bundle.objects, 2)),
      );
      mocks.acknowledge.mockResolvedValueOnce({}).mockRejectedValueOnce(resourceReconcileRequestError(409));
      const execution: Promise<void> = executeResourceReconcile(requester(), runtime(apply, observation), claim(null));
      const rejected: Promise<void> = expect(execution).rejects.toThrow('lease is no longer current');
      await vi.waitFor((): void => {
        expect(apply).toHaveBeenCalledTimes(2);
      });

      await vi.advanceTimersByTimeAsync(resourceReconcileLeaseHeartbeatIntervalMs);
      await rejected;
      expect(apply).toHaveBeenCalledTimes(2);
      expect(mocks.acknowledge).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
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

  it('starts readiness after the mounted WFFC data claim binds while the backup claim remains pending', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const observation: TestObservation = new TestObservation('uid-original', false, false, false);
      observation.addClaim(backupClaimName, 'uid-backup', false);
      let appliedDeployment: KubeDeploymentManifest | null = null;
      const apply: Mock = vi.fn(async (bundle: ApplyBundle): Promise<KubeManifest[]> => {
        const applied: KubeManifest[] = withAppliedDeploymentIdentity(bundle.objects, 2);
        const deployment: KubeManifest | undefined = applied.find(
          (object: KubeManifest): boolean => object.kind === 'Deployment' && object.spec?.replicas === 1,
        );
        if (deployment?.kind === 'Deployment') {
          appliedDeployment = deployment;
        }
        return await Promise.resolve(applied);
      });
      const claimed: WorkerClaimResourceReconcileResponse = claim(null);
      const execution: Promise<void> = executeResourceReconcile(requester(), runtime(apply, observation), {
        ...claimed,
        intent:
          claimed.intent === null
            ? null
            : { ...claimed.intent, readiness: { port: 5432, timeoutMs: 1_000, type: 'tcp' } },
      });
      let settled: boolean = false;
      void execution.finally((): void => {
        settled = true;
      });
      await vi.waitFor((): void => {
        expect(appliedDeployment).not.toBeNull();
      });

      expect(appliedDeployment!.spec!.progressDeadlineSeconds).toBe(
        Math.ceil((infrastructureTimeoutMs * 2 + 1_000) / 1_000),
      );
      expect(appliedDeployment!.spec!.template.spec.volumes).toEqual([
        { name: dataClaimName, persistentVolumeClaim: { claimName: dataClaimName } },
      ]);
      expect(appliedDeployment!.spec!.template.spec.containers[0]!.volumeMounts).toEqual([
        { mountPath: '/data', name: dataClaimName },
      ]);
      await vi.advanceTimersByTimeAsync(8 * 60_000);
      expect(settled).toBe(false);
      expect(mocks.acknowledge).toHaveBeenCalledTimes(
        1 + Math.floor((8 * 60_000) / resourceReconcileLeaseHeartbeatIntervalMs),
      );
      expect(mocks.acknowledge).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ status: 'running' }),
      );

      observation.bindClaim(dataClaimName);
      await vi.advanceTimersByTimeAsync(3 * 60_000);
      expect(settled).toBe(false);
      observation.addReadyDeployment(appliedDeployment!, 2);
      await execution;

      expect(observation.cache.get(`persistentvolumeclaims/ns/${backupClaimName}`)?.status).toEqual({
        phase: 'Pending',
      });
      expect(mocks.acknowledge).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ status: 'succeeded' }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts the declared readiness budget when the resource container enters Running', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const observation: TestObservation = new TestObservation('uid-original', false, true, false);
      observation.addClaim(backupClaimName, 'uid-backup', false);
      let appliedDeployment: KubeDeploymentManifest | null = null;
      const apply: Mock = vi.fn(async (bundle: ApplyBundle): Promise<KubeManifest[]> => {
        const applied: KubeManifest[] = withAppliedDeploymentIdentity(bundle.objects, 2);
        const deployment: KubeManifest | undefined = applied.find(
          (object: KubeManifest): boolean => object.kind === 'Deployment' && object.spec?.replicas === 1,
        );
        if (deployment?.kind === 'Deployment') {
          appliedDeployment = deployment;
        }
        return await Promise.resolve(applied);
      });
      const claimed: WorkerClaimResourceReconcileResponse = claim(null);
      const execution: Promise<void> = executeResourceReconcile(requester(), runtime(apply, observation), {
        ...claimed,
        intent:
          claimed.intent === null
            ? null
            : { ...claimed.intent, readiness: { port: 5432, timeoutMs: 60_000, type: 'tcp' } },
      });
      let settled: boolean = false;
      void execution.finally((): void => {
        settled = true;
      });
      await vi.waitFor((): void => {
        expect(appliedDeployment).not.toBeNull();
      });

      await vi.advanceTimersByTimeAsync(3 * 60_000);
      expect(settled).toBe(false);
      observation.addRunningResourcePod(appliedDeployment!, new Date());
      await vi.advanceTimersByTimeAsync(59_000);
      expect(settled).toBe(false);

      observation.addReadyDeployment(appliedDeployment!, 2);
      await execution;
    } finally {
      vi.useRealTimers();
    }
  });

  it('completes a resource stop without waiting for a Running container', async (): Promise<void> => {
    const observation: TestObservation = new TestObservation('uid-original', false);
    observation.addClaim(backupClaimName, 'uid-backup', false);
    const apply: Mock = vi.fn(
      async (bundle: ApplyBundle): Promise<KubeManifest[]> =>
        await Promise.resolve(withAppliedDeploymentIdentity(bundle.objects, 2)),
    );

    await executeResourceReconcile(requester(), runtime(apply, observation), stopClaim());

    expect(apply).toHaveBeenCalledTimes(2);
    expect(mocks.acknowledge).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'succeeded' }),
    );
  });

  it('applies the current resource port policy before starting the resource workload', async (): Promise<void> => {
    const observation: TestObservation = new TestObservation('uid-original', false, true, false);
    observation.addClaim(backupClaimName, 'uid-backup', false);
    const apply: Mock = vi.fn(async (bundle: ApplyBundle): Promise<KubeManifest[]> => {
      const applied: KubeManifest[] = withAppliedDeploymentIdentity(bundle.objects, 2);
      const deployment: KubeManifest | undefined = applied.find(
        (object: KubeManifest): boolean => object.kind === 'Deployment',
      );
      if (deployment !== undefined) {
        observation.addReadyDeployment(deployment, 2);
      }
      return await Promise.resolve(applied);
    });
    const claimed: WorkerClaimResourceReconcileResponse = {
      ...claim(null),
      networkPolicy: { applicationPorts: [8080], resourcePorts: [6379] },
    };

    await executeResourceReconcile(requester(), runtime(apply, observation), claimed);

    expect(mocks.applyNetworkPolicy).toHaveBeenCalledWith(expect.anything(), 'project', {
      applicationPorts: [8080],
      resourcePorts: [6379],
    });
    expect(mocks.applyNetworkPolicy.mock.invocationCallOrder[0]).toBeLessThan(apply.mock.invocationCallOrder[0]!);
    expect(mocks.acknowledge).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'succeeded' }),
    );
  });

  it('fails closed when a live PVC read is incomplete', async (): Promise<void> => {
    const observation: TestObservation = new TestObservation('uid-original', false);
    const apply: Mock = vi.fn();
    const read: Mock = vi.fn();
    const kubeRuntime: KubeRuntime = runtime(apply, observation, read);

    await expect(executeResourceReconcile(requester(), kubeRuntime, claim(null))).rejects.toThrow('is missing');

    expect(observation.cache.has(`persistentvolumeclaims/ns/${backupClaimName}`)).toBe(false);
    expect(read).toHaveBeenCalledTimes(2);
    expect(apply).not.toHaveBeenCalled();
  });

  it('uses direct Kubernetes reads for managed PVC ownership fences', async (): Promise<void> => {
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
    const read: Mock = vi.fn(
      async (manifest: KubeManifest): Promise<KubeObservedManifest | null> =>
        await readFromObservation(observation, manifest),
    );
    const kubeRuntime: KubeRuntime = runtime(apply, observation, read);

    await executeResourceReconcile(requester(), kubeRuntime, claim(null));

    expect(read).toHaveBeenCalled();
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

  it('rejects readiness from an external generation newer than the applied Deployment', async (): Promise<void> => {
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
      const applied: KubeManifest[] = withAppliedDeploymentIdentity(bundle.objects, 2);
      appliedDeployment = applied.find((object: KubeManifest): boolean => object.kind === 'Deployment') ?? null;
      return await Promise.resolve(applied);
    });

    const execution: Promise<void> = executeResourceReconcile(requester(), runtime(apply, observation), claim(null));
    await vi.waitFor((): void => {
      expect(appliedDeployment).not.toBeNull();
    });
    observation.addReadyDeployment(
      { ...appliedDeployment!, metadata: { ...appliedDeployment!.metadata, generation: 3 } },
      2,
    );
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
    expect(mocks.acknowledge).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'succeeded' }),
    );

    observation.addReadyDeployment(appliedDeployment!, 2);
    await execution;
  });

  it('waits for every replica of the applied revision instead of accepting an old available replica', async (): Promise<void> => {
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
      const applied: KubeManifest[] = withAppliedDeploymentIdentity(bundle.objects, 2);
      appliedDeployment = applied.find((object: KubeManifest): boolean => object.kind === 'Deployment') ?? null;
      return await Promise.resolve(applied);
    });

    const execution: Promise<void> = executeResourceReconcile(requester(), runtime(apply, observation), claim(null));
    await vi.waitFor((): void => {
      expect(appliedDeployment).not.toBeNull();
    });
    observation.addReadyDeployment(appliedDeployment!, 2, 0);
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
    expect(mocks.acknowledge).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'succeeded' }),
    );

    observation.addReadyDeployment(appliedDeployment!, 2);
    await execution;
  });

  it('fails immediately on progress-deadline evidence for the applied Deployment revision', async (): Promise<void> => {
    const observation: TestObservation = new TestObservation('uid-original', false, true, false);
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
      const applied: KubeManifest[] = withAppliedDeploymentIdentity(bundle.objects, 2);
      appliedDeployment = applied.find((object: KubeManifest): boolean => object.kind === 'Deployment') ?? null;
      return await Promise.resolve(applied);
    });

    const execution: Promise<void> = executeResourceReconcile(requester(), runtime(apply, observation), claim(null));
    await vi.waitFor((): void => {
      expect(appliedDeployment).not.toBeNull();
    });
    observation.addRunningResourcePod(appliedDeployment!, new Date());
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
    observation.addFailedDeployment(appliedDeployment!, 2);

    await expect(execution).rejects.toThrow('configured progress deadline');
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
    await expect(
      executeResourceReconcile(requester(), runtime(apply, observation), claim(null), {
        nodeSelector: { 'compartment.dev/node-pool': 'tenant' },
        tolerations: [{ effect: 'NoSchedule', key: 'compartment.dev/node-pool', operator: 'Exists' }],
      }),
    ).rejects.toThrow('new image failed');
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
    const rollbackDeployment: KubeManifest | undefined = bundles[3]?.objects.find(
      (object: KubeManifest): boolean => object.kind === 'Deployment',
    );
    expect(rollbackDeployment?.spec).toMatchObject({
      template: {
        spec: {
          nodeSelector: { 'compartment.dev/node-pool': 'tenant' },
          priorityClassName: 'compartment-tenant',
          tolerations: [{ effect: 'NoSchedule', key: 'compartment.dev/node-pool', operator: 'Exists' }],
        },
      },
    });
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

  it('uses the rollback Deployment deadline instead of the failed replacement deadline', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const observation: TestObservation = new TestObservation('uid-original', true);
      observation.addClaim(backupClaimName, 'uid-backup', false);
      let rollbackDeployment: KubeManifest | null = null;
      const apply: Mock = vi.fn(async (bundle: ApplyBundle): Promise<KubeManifest[]> => {
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
        rollbackDeployment = applied.find((object: KubeManifest): boolean => object.kind === 'Deployment') ?? null;
        return await Promise.resolve(applied);
      });
      const claimed: WorkerClaimResourceReconcileResponse = claim(null);
      const execution: Promise<void> = executeResourceReconcile(requester(), runtime(apply, observation), {
        ...claimed,
        intent:
          claimed.intent === null
            ? null
            : { ...claimed.intent, readiness: { port: 5432, timeoutMs: 1_000, type: 'tcp' } },
      });
      let settled: boolean = false;
      void execution.then(
        (): void => {
          settled = true;
        },
        (): void => {
          settled = true;
        },
      );
      await vi.waitFor((): void => {
        expect(rollbackDeployment).not.toBeNull();
      });

      await vi.advanceTimersByTimeAsync(1_001);
      expect(settled).toBe(false);

      observation.addReadyDeployment(rollbackDeployment!, 2);
      await expect(execution).rejects.toThrow('new image failed');
      expect(mocks.acknowledge).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ failureMessage: 'new image failed', status: 'failed' }),
      );
    } finally {
      vi.useRealTimers();
    }
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

    const deleted: WorkerClaimResourceReconcileResponse = {
      ...deleteClaim(),
      networkPolicy: { applicationPorts: [8080], resourcePorts: [] },
    };

    await executeResourceReconcile(requester(), runtime(apply, observation, undefined, remove), deleted);

    expect(mocks.applyNetworkPolicy).toHaveBeenCalledExactlyOnceWith(expect.anything(), 'project', {
      applicationPorts: [8080],
      resourcePorts: [],
    });
    expect(mocks.applyNetworkPolicy.mock.invocationCallOrder[0]).toBeGreaterThan(remove.mock.invocationCallOrder[0]!);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(removed[0]?.map((object: KubeManifest): string => object.kind)).toEqual(['Secret', 'Service', 'Deployment']);
    expect(removed[1]).toHaveLength(2);
    expect(removed[1]?.map((object: KubeManifest): string | undefined => object.metadata?.uid)).toEqual([
      'uid-original',
      'uid-backup',
    ]);
    expect(removed[1]?.map((object: KubeManifest): string | undefined => object.metadata?.resourceVersion)).toEqual([
      'uid-original-rv',
      'uid-backup-rv',
    ]);
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

  it('rejects a live PVC replacement even while the informer still reports the expected UID', async (): Promise<void> => {
    const observation: TestObservation = new TestObservation('uid-original', true);
    observation.addClaim(backupClaimName, 'uid-backup', false);
    const apply: Mock = vi.fn(async (bundle: ApplyBundle): Promise<KubeManifest[]> => {
      observation.removePods();
      return await Promise.resolve(bundle.objects);
    });
    const read: Mock = vi.fn(async (manifest: KubeManifest): Promise<KubeObservedManifest | null> => {
      const observed: KubeObservedManifest | null = await readFromObservation(observation, manifest);
      if (manifest.kind !== 'PersistentVolumeClaim' || manifest.metadata?.name !== dataClaimName || observed === null) {
        return observed;
      }
      return {
        ...observed,
        metadata: { ...observed.metadata, resourceVersion: 'replacement-rv', uid: 'uid-replacement' },
      };
    });
    const remove: Mock = vi.fn();

    await expect(
      executeResourceReconcile(requester(), runtime(apply, observation, read, remove), deleteClaim()),
    ).rejects.toThrow('UID changed');

    expect(remove).not.toHaveBeenCalled();
  });

  it('completes a retried data deletion after the PVCs were already removed before acknowledgement', async (): Promise<void> => {
    const observation: TestObservation = new TestObservation('uid-original', false);
    observation.removeClaims();
    const apply: Mock = vi.fn(
      async (bundle: ApplyBundle): Promise<KubeManifest[]> => await Promise.resolve(bundle.objects),
    );
    const remove: Mock = vi.fn();

    await executeResourceReconcile(requester(), runtime(apply, observation, undefined, remove), deleteClaim());

    expect(remove).toHaveBeenCalledOnce();
    expect(mocks.acknowledge).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'succeeded' }),
    );
  });

  it('completes a retried data deletion after only one PVC was removed before acknowledgement', async (): Promise<void> => {
    const observation: TestObservation = new TestObservation('uid-original', false);
    observation.addClaim(backupClaimName, 'uid-backup', false);
    observation.removeClaim(dataClaimName);
    const apply: Mock = vi.fn(
      async (bundle: ApplyBundle): Promise<KubeManifest[]> => await Promise.resolve(bundle.objects),
    );
    const removed: KubeManifest[][] = [];
    const remove: Mock = vi.fn(async (objects: KubeManifest[]): Promise<void> => {
      removed.push(objects);
      await Promise.resolve();
    });

    await executeResourceReconcile(requester(), runtime(apply, observation, undefined, remove), deleteClaim());

    expect(remove).toHaveBeenCalledTimes(2);
    expect(removed[1]).toHaveLength(1);
    expect(removed[1]?.[0]?.metadata).toMatchObject({ name: backupClaimName, uid: 'uid-backup' });
    expect(mocks.acknowledge).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'succeeded' }),
    );
  });

  it('refuses partial deletion when an absent projected claim does not match the persisted handle set', async (): Promise<void> => {
    const observation: TestObservation = new TestObservation('uid-original', false);
    observation.removeClaim(backupClaimName);
    const apply: Mock = vi.fn(
      async (bundle: ApplyBundle): Promise<KubeManifest[]> => await Promise.resolve(bundle.objects),
    );
    const remove: Mock = vi.fn();
    const claimed: WorkerClaimResourceReconcileResponse = deleteClaim();

    await expect(
      executeResourceReconcile(requester(), runtime(apply, observation, undefined, remove), {
        ...claimed,
        expectedClaims: [
          { claimName: dataClaimName, uid: 'uid-original' },
          { claimName: 'legacy-claim', uid: 'uid-legacy' },
        ],
      }),
    ).rejects.toThrow('handle mapping changed');

    expect(remove).not.toHaveBeenCalled();
  });
});

class TestObservation implements KubeObservation {
  public readonly cache: Map<string, KubeObservedManifest> = new Map<string, KubeObservedManifest>();
  private readonly listeners: Set<TestKubeObservationListener> = new Set<TestKubeObservationListener>();
  public constructor(uid: string, withPod: boolean, bound: boolean = true, withDeployment: boolean = true) {
    this.cache.set(`persistentvolumeclaims/ns/${dataClaimName}`, {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: { name: dataClaimName, resourceVersion: `${uid}-rv`, uid },
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
    this.cache.set(`secrets/ns/${secretName}`, {
      apiVersion: 'v1',
      data: { PASSWORD: 'old' },
      kind: 'Secret',
      metadata: { name: secretName, namespace: 'cpt-project', resourceVersion: '43' },
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
  public health(): TestKubeObservationHealth {
    return { healthy: true, lastConnectedAt: new Date(), lastErrorAt: null };
  }
  public onEvent(listener: TestKubeObservationListener): () => void {
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
  public removeClaims(): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith('persistentvolumeclaims/')) {
        this.cache.delete(key);
      }
    }
  }
  public removeClaim(name: string): void {
    this.cache.delete(`persistentvolumeclaims/ns/${name}`);
  }
  public addPod(name: string): void {
    this.cache.set(`pods/ns/${name}`, { metadata: { name } } as KubeObservedManifest);
  }
  public addRunningResourcePod(deployment: KubeManifest, startedAt: Date): void {
    if (deployment.kind !== 'Deployment') {
      throw new Error('Expected a Deployment manifest.');
    }
    const labels: Record<string, string> | undefined = deployment.spec?.template.metadata.labels;
    const containerName: string | undefined = deployment.spec?.template.spec.containers[0]?.name;
    if (labels === undefined || containerName === undefined) {
      throw new Error('Expected resource Pod identity.');
    }
    const pod: KubeObservedManifest = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { labels, name: 'resource-pod', namespace: 'cpt-project' },
      status: {
        containerStatuses: [{ name: containerName, state: { running: { startedAt: startedAt.toISOString() } } }],
      },
    };
    this.cache.set('pods/ns/resource-pod', pod);
    this.listeners.forEach((listener: TestKubeObservationListener): void => {
      void listener({ object: pod, observedAt: new Date(), resource: 'pods', type: 'update' });
    });
  }
  public addReadyDeployment(deployment: KubeManifest, observedGeneration?: number, updatedReplicas: number = 1): void {
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
        replicas: 1,
        updatedReplicas,
      },
    };
    if (deployment.spec?.replicas === 1) {
      this.addRunningResourcePod(deployment, new Date());
    }
    this.cache.set(`deployments/ns/${resourceName}`, observed);
    this.listeners.forEach((listener: TestKubeObservationListener): void => {
      void listener({ object: observed, observedAt: new Date(), resource: 'deployments', type: 'update' });
    });
  }
  public addFailedDeployment(deployment: KubeManifest, observedGeneration: number): void {
    if (deployment.kind !== 'Deployment') {
      throw new Error('Expected a Deployment manifest.');
    }
    const observed: KubeObservedManifest = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { ...deployment.metadata, name: resourceName },
      spec: deployment.spec,
      status: {
        availableReplicas: 0,
        conditions: [{ reason: 'ProgressDeadlineExceeded', status: 'False', type: 'Progressing' }],
        observedGeneration,
      },
    };
    this.cache.set(`deployments/ns/${resourceName}`, observed);
    this.listeners.forEach((listener: TestKubeObservationListener): void => {
      void listener({ object: observed, observedAt: new Date(), resource: 'deployments', type: 'update' });
    });
  }
  public addClaim(name: string, uid: string, bound: boolean): void {
    this.cache.set(`persistentvolumeclaims/ns/${name}`, {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: { name, resourceVersion: `${uid}-rv`, uid },
      status: { phase: bound ? 'Bound' : 'Pending' },
    });
  }
  public bindClaim(name: string): void {
    const observedClaim: KubeObservedManifest | undefined = this.cache.get(`persistentvolumeclaims/ns/${name}`);
    if (observedClaim !== undefined) {
      observedClaim.status = { phase: 'Bound' };
      this.listeners.forEach((listener: TestKubeObservationListener): void => {
        void listener({
          object: observedClaim,
          observedAt: new Date(),
          resource: 'persistentvolumeclaims',
          type: 'update',
        });
      });
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
      command: [],
      deleteData: false,
      environmentId: 'env',
      env: {},
      image: 'postgres:17',
      namespaceId: 'project',
      operation: 'reconcile',
      ports: [5432],
      readiness: { port: 5432, timeoutMs: 30_000, type: 'tcp' },
      replicas: 1,
      resourceId: 'resource',
      secretId: 'secret',
      volumes: [{ mountPath: '/data', size: '1Gi', volumeHandle: 'data' }],
    },
    leaseId: 'lease-1',
    networkPolicy: { applicationPorts: [8080], resourcePorts: [5432] },
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

function stopClaim(): WorkerClaimResourceReconcileResponse {
  const claimed: WorkerClaimResourceReconcileResponse = claim(null);
  return { ...claimed, intent: { ...claimed.intent!, replicas: 0 } };
}

function withAppliedDeploymentIdentity(objects: KubeManifest[], generation: number): KubeManifest[] {
  return objects.map(
    (object: KubeManifest): KubeManifest =>
      object.kind === 'Deployment'
        ? { ...object, metadata: { ...object.metadata, generation, uid: 'deployment-uid' } }
        : object,
  );
}
