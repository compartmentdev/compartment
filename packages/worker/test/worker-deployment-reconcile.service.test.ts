import type { DeploymentReconcileProjection, DeploymentReconcileTarget } from '@compartment/contracts';
import {
  kubeApplicationIdentityName,
  kubeNamespaceName,
  type ApplyBundle,
  type KubeManifest,
  type KubeRuntime,
} from '@compartment/kube-runtime';
import type { CompartmentRequester } from '@compartment/sdk';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { reconcileDeploymentTarget } from '../src/services/worker-deployment-reconcile.service';

interface ReconcileMocks {
  delay: Mock;
  executeProductJob: Mock;
  observeDeploymentReconcile: Mock;
}

const mocks: ReconcileMocks = vi.hoisted(
  (): ReconcileMocks => ({ delay: vi.fn(), executeProductJob: vi.fn(), observeDeploymentReconcile: vi.fn() }),
);

vi.mock('node:timers/promises', (): object => ({ setTimeout: mocks.delay }));

vi.mock('@compartment/sdk', async (importOriginal: () => Promise<object>): Promise<object> => {
  const original: object = await importOriginal();
  return { ...original, observeDeploymentReconcile: mocks.observeDeploymentReconcile };
});

vi.mock('../src/services/worker-product-job.service', (): object => ({
  executeProductJob: mocks.executeProductJob,
}));

describe('deployment reconciliation', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    mocks.delay.mockResolvedValue(undefined);
    mocks.executeProductJob.mockResolvedValue({ status: 'succeeded' });
    mocks.observeDeploymentReconcile.mockResolvedValue({ applied: true });
  });

  it('does not start rollout when the release Job fails', async (): Promise<void> => {
    const runtime: KubeRuntime & { apply: Mock } = runtimeStub();
    mocks.executeProductJob.mockRejectedValue(new Error('release exited 17'));

    await reconcileDeploymentTarget(requester(), runtime, target(projection('bin/migrate')));

    expect(runtime.apply).not.toHaveBeenCalled();
    expect(mocks.observeDeploymentReconcile).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ message: 'release exited 17', observation: 'failed', revision: 0 }),
    );
  });

  it('applies the candidate only after a successful release Job and then persists pending', async (): Promise<void> => {
    const runtime: KubeRuntime & { apply: Mock } = runtimeStub();

    await reconcileDeploymentTarget(requester(), runtime, target(projection('bin/migrate')));

    expect(mocks.executeProductJob).toHaveBeenCalledOnce();
    expect(runtime.apply).toHaveBeenCalledOnce();
    const bundle: ApplyBundle = runtime.apply.mock.calls[0]?.[0] as ApplyBundle;
    expect(bundle.objects.some((object: KubeManifest): boolean => object.kind === 'Deployment')).toBe(true);
    expect(mocks.observeDeploymentReconcile).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'pending', revision: 0 }),
    );
  });

  it('reads active Deployment readiness directly without depending on the informer cache', async (): Promise<void> => {
    const runtime: KubeRuntime & { apply: Mock } = activeRuntimeStub();
    const activeTarget: DeploymentReconcileTarget = { ...target(projection(null)), state: 'active' };

    await reconcileDeploymentTarget(requester(), runtime, activeTarget);

    expect(runtime.apply).toHaveBeenCalledOnce();
    expect(mocks.observeDeploymentReconcile).not.toHaveBeenCalled();
  });

  it('keeps an active Deployment active on a transient non-ready observation', async (): Promise<void> => {
    const runtime: KubeRuntime & { apply: Mock; observe: Mock; read: Mock } = activeRuntimeStub(false);
    const namespace: string = kubeNamespaceName('prj_1');
    const name: string = kubeApplicationIdentityName('env_1', 'svc_1');
    runtime.read
      .mockResolvedValueOnce(progressingDeployment(namespace, name))
      .mockResolvedValue(readyDeployment(namespace, name));
    const activeTarget: DeploymentReconcileTarget = {
      ...target(projection(null)),
      state: 'active',
    };

    await reconcileDeploymentTarget(requester(), runtime, activeTarget);

    expect(runtime.observe).not.toHaveBeenCalled();
    expect(runtime.read).toHaveBeenCalledTimes(2);
    expect(mocks.observeDeploymentReconcile).not.toHaveBeenCalled();
  });

  it('demotes an active Deployment when its rollout observation times out', async (): Promise<void> => {
    const runtime: KubeRuntime & { apply: Mock; read: Mock } = activeRuntimeStub(false);
    const activeTarget: DeploymentReconcileTarget = { ...target(projection(null)), state: 'active' };

    await reconcileDeploymentTarget(requester(), runtime, activeTarget);

    expect(runtime.read).toHaveBeenCalledTimes(6);
    expect(mocks.observeDeploymentReconcile).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'pending', revision: 0 }),
    );
  });

  it('demotes a persistently deadline-exceeded active Deployment only after the grace reads', async (): Promise<void> => {
    const runtime: KubeRuntime & { apply: Mock; read: Mock } = activeRuntimeStub(false, true);
    const activeTarget: DeploymentReconcileTarget = { ...target(projection(null)), state: 'active' };

    await reconcileDeploymentTarget(requester(), runtime, activeTarget);

    expect(runtime.read).toHaveBeenCalledTimes(6);
    expect(mocks.observeDeploymentReconcile).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'pending', revision: 0 }),
    );
  });

  it('restarts a deadline-exceeded active Deployment without terminally failing its recovery claim', async (): Promise<void> => {
    const runtime: KubeRuntime & { apply: Mock; delete: Mock } = activeRuntimeStub(false, true) as never;
    runtime.delete = vi.fn(async (): Promise<void> => await Promise.resolve());
    const candidate: DeploymentReconcileProjection = projection(null);
    const pendingTarget: DeploymentReconcileTarget = {
      ...target(candidate),
      active: candidate,
      state: 'pending',
    };

    await reconcileDeploymentTarget(requester(), runtime, pendingTarget);

    expect(runtime.delete).toHaveBeenCalledWith([expect.objectContaining({ kind: 'Deployment' })]);
    expect(runtime.apply).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
    expect(mocks.observeDeploymentReconcile).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'pending', revision: 0 }),
    );
    expect(mocks.observeDeploymentReconcile).not.toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'failed' }),
    );
  });

  it('keeps a pending rollout alive for the configured readiness timeout', async (): Promise<void> => {
    const runtime: KubeRuntime & { apply: Mock } = pendingRuntimeStub(false);
    const pendingTarget: DeploymentReconcileTarget = {
      ...target(projection(null)),
      rolloutStartedAt: new Date(Date.now() - 55_000).toISOString(),
      state: 'pending',
    };

    await reconcileDeploymentTarget(requester(), runtime, pendingTarget);

    expect(runtime.apply).toHaveBeenCalledOnce();
    expect(mocks.observeDeploymentReconcile).not.toHaveBeenCalled();
  });

  it('reads a ready pending Deployment without depending on informer startup', async (): Promise<void> => {
    const runtime: KubeRuntime & { apply: Mock } = pendingRuntimeStub(true);
    const pendingTarget: DeploymentReconcileTarget = {
      ...target(projection(null)),
      rolloutStartedAt: '2026-07-12T12:00:00.000Z',
      state: 'pending',
    };

    await reconcileDeploymentTarget(requester(), runtime, pendingTarget);

    expect(mocks.observeDeploymentReconcile).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'ready', revision: 0 }),
    );
  });

  it('rejects ready pending Deployments that do not match the UID and generation returned by apply', async (): Promise<void> => {
    const namespace: string = kubeNamespaceName('prj_1');
    const name: string = kubeApplicationIdentityName('env_1', 'svc_1');
    const applied: KubeManifest = readyDeployment(namespace, name, 'applied-uid', 2);
    const runtime: KubeRuntime & { apply: Mock; read: Mock } = {
      apply: vi.fn(async (): Promise<KubeManifest[]> => await Promise.resolve([applied])),
      read: vi.fn(
        async (): Promise<KubeManifest> => await Promise.resolve(readyDeployment(namespace, name, 'foreign-uid', 2)),
      ),
    } as never;
    const pendingTarget: DeploymentReconcileTarget = { ...target(projection(null)), state: 'pending' };

    await reconcileDeploymentTarget(requester(), runtime, pendingTarget);

    expect(mocks.observeDeploymentReconcile).not.toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'ready' }),
    );
  });

  it('rejects ready pending Deployments from a generation newer than the current apply', async (): Promise<void> => {
    const namespace: string = kubeNamespaceName('prj_1');
    const name: string = kubeApplicationIdentityName('env_1', 'svc_1');
    const applied: KubeManifest = readyDeployment(namespace, name, 'applied-uid', 2);
    const runtime: KubeRuntime & { apply: Mock; read: Mock } = {
      apply: vi.fn(async (): Promise<KubeManifest[]> => await Promise.resolve([applied])),
      read: vi.fn(
        async (): Promise<KubeManifest> => await Promise.resolve(readyDeployment(namespace, name, 'applied-uid', 3)),
      ),
    } as never;
    const pendingTarget: DeploymentReconcileTarget = { ...target(projection(null)), state: 'pending' };

    await reconcileDeploymentTarget(requester(), runtime, pendingTarget);

    expect(mocks.observeDeploymentReconcile).not.toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'ready' }),
    );
  });

  it('deletes the projected application before acknowledging a Kubernetes stop', async (): Promise<void> => {
    const runtime: KubeRuntime & { delete: Mock } = {
      ...runtimeStub(),
      delete: vi.fn(async (): Promise<void> => await Promise.resolve()),
    } as never;
    const stoppingTarget: DeploymentReconcileTarget = { ...target(projection(null)), state: 'stopping' };

    await reconcileDeploymentTarget(requester(), runtime, stoppingTarget);

    const deleted: KubeManifest[] = runtime.delete.mock.calls[0]?.[0] as KubeManifest[];
    expect(deleted.map((manifest: KubeManifest): string => manifest.kind)).toEqual(['Secret', 'Deployment', 'Service']);
    expect(mocks.observeDeploymentReconcile).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'stopped', revision: 0 }),
    );
  });
});

function target(candidate: DeploymentReconcileProjection): DeploymentReconcileTarget {
  return {
    active: null,
    candidate,
    revision: 0,
    rolloutStartedAt: '2026-07-12T12:00:00.000Z',
    state: 'desired',
  };
}

function projection(releaseCommand: string | null): DeploymentReconcileProjection {
  return {
    containerPort: 3000,
    deploymentId: 'dep_candidate',
    environmentId: 'env_1',
    environmentName: 'production',
    env: { PORT: '3000' },
    image: 'registry.example/app@sha256:candidate',
    imagePullSecretId: 'prj_1',
    namespaceId: 'prj_1',
    organizationId: 'org_1',
    organizationName: 'Acme',
    projectId: 'prj_1',
    projectName: 'checkout',
    readiness: { path: '/healthz', timeoutMs: 60_000, type: 'http' },
    releaseCommand,
    replicas: 1,
    runCommand: null,
    secretId: 'dep_candidate',
    serviceId: 'svc_1',
    serviceName: 'web',
    terminationGracePeriodSeconds: 45,
  };
}

function runtimeStub(): KubeRuntime & { apply: Mock } {
  return {
    apply: vi.fn(async (): Promise<KubeManifest[]> => await Promise.resolve([])),
    read: vi.fn(async (): Promise<KubeManifest | null> => await Promise.resolve(null)),
  } as never;
}

function activeRuntimeStub(
  ready: boolean = true,
  progressDeadlineExceeded: boolean = false,
): KubeRuntime & { apply: Mock; observe: Mock; read: Mock } {
  const namespace: string = kubeNamespaceName('prj_1');
  const name: string = kubeApplicationIdentityName('env_1', 'svc_1');
  return {
    apply: vi.fn(
      async (): Promise<KubeManifest[]> => await Promise.resolve([readyDeployment(namespace, name, 'applied-uid', 1)]),
    ),
    observe: vi.fn(),
    read: vi.fn(
      async (): Promise<KubeManifest> =>
        await Promise.resolve(
          ready ? readyDeployment(namespace, name) : progressingDeployment(namespace, name, progressDeadlineExceeded),
        ),
    ),
  } as never;
}

function pendingRuntimeStub(publishAfterSubscribe: boolean): KubeRuntime & { apply: Mock } {
  const namespace: string = kubeNamespaceName('prj_1');
  const name: string = kubeApplicationIdentityName('env_1', 'svc_1');
  const applied: KubeManifest = readyDeployment(namespace, name);
  return {
    apply: vi.fn(async (): Promise<KubeManifest[]> => await Promise.resolve([applied])),
    read: vi.fn(
      async (): Promise<KubeManifest> =>
        await Promise.resolve(
          publishAfterSubscribe ? readyDeployment(namespace, name) : progressingDeployment(namespace, name),
        ),
    ),
  } as never;
}

function progressingDeployment(
  namespace: string,
  name: string,
  progressDeadlineExceeded: boolean = false,
): KubeManifest {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { generation: 1, name, namespace },
    status: {
      availableReplicas: 0,
      conditions: progressDeadlineExceeded
        ? [{ reason: 'ProgressDeadlineExceeded', status: 'False', type: 'Progressing' }]
        : [],
      observedGeneration: 1,
    },
  } as never;
}

function readyDeployment(
  namespace: string,
  name: string,
  uid: string = 'applied-uid',
  generation: number = 1,
): KubeManifest {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { generation, name, namespace, uid },
    status: { availableReplicas: 1, observedGeneration: generation, replicas: 1, updatedReplicas: 1 },
  } as never;
}

function requester(): CompartmentRequester {
  return async function unexpectedRequest<TResult>(): Promise<TResult> {
    await Promise.resolve();
    throw new Error('Unexpected direct request.');
  };
}
