import type { DeploymentReconcileProjection, DeploymentReconcileTarget } from '@compartment/contracts';
import {
  kubeApplicationIdentityName,
  kubeNamespaceName,
  type ApplyBundle,
  type KubeManifest,
  type KubeObservation,
  type KubeObservationEvent,
  type KubeObservationHealth,
  type KubeRuntime,
} from '@compartment/kube-runtime';
import type { CompartmentRequester } from '@compartment/sdk';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { reconcileDeploymentTarget } from '../src/services/worker-deployment-reconcile.service';

interface ReconcileMocks {
  executeProductJob: Mock;
  observeDeploymentReconcile: Mock;
}

type TestObservationListener = (event: KubeObservationEvent) => void;

const mocks: ReconcileMocks = vi.hoisted(
  (): ReconcileMocks => ({ executeProductJob: vi.fn(), observeDeploymentReconcile: vi.fn() }),
);

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

  it('waits for the informer cache before evaluating an active Deployment', async (): Promise<void> => {
    const runtime: KubeRuntime & { apply: Mock } = activeRuntimeStub();
    const activeTarget: DeploymentReconcileTarget = { ...target(projection(null)), state: 'active' };

    await reconcileDeploymentTarget(requester(), runtime, activeTarget);

    expect(runtime.apply).toHaveBeenCalledOnce();
    expect(mocks.observeDeploymentReconcile).not.toHaveBeenCalled();
  });

  it('does not lose an active Deployment cache update between the initial read and event subscription', async (): Promise<void> => {
    const runtime: KubeRuntime & { apply: Mock } = activeRuntimeStub(true);
    const activeTarget: DeploymentReconcileTarget = { ...target(projection(null)), state: 'active' };

    await reconcileDeploymentTarget(requester(), runtime, activeTarget);

    expect(mocks.observeDeploymentReconcile).not.toHaveBeenCalled();
  });

  it('keeps a pending rollout alive for the configured readiness timeout', async (): Promise<void> => {
    const runtime: KubeRuntime & { apply: Mock } = pendingRuntimeStub(false);
    const pendingTarget: DeploymentReconcileTarget = {
      ...target(projection(null)),
      rolloutStartedAt: new Date(Date.now() - 55_000).toISOString(),
      state: 'pending',
    };

    await reconcileDeploymentTarget(requester(), runtime, pendingTarget);

    expect(runtime.apply).not.toHaveBeenCalled();
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

function activeRuntimeStub(populateWithoutEvent: boolean = false): KubeRuntime & { apply: Mock } {
  const cache: Map<string, KubeManifest> = new Map<string, KubeManifest>();
  return {
    apply: vi.fn(async (): Promise<KubeManifest[]> => await Promise.resolve([])),
    observe: vi.fn(
      async (): Promise<KubeObservation> =>
        await Promise.resolve({
          cache,
          health: (): KubeObservationHealth => ({ healthy: true, lastConnectedAt: new Date(), lastErrorAt: null }),
          onEvent: (listener: TestObservationListener): (() => void) => {
            if (populateWithoutEvent) {
              publishReadyDeployment(cache);
              return (): void => undefined;
            }
            const timer: NodeJS.Timeout = setTimeout((): void => publishReadyDeployment(cache, listener), 0);
            return (): void => clearTimeout(timer);
          },
          stop: async (): Promise<void> => await Promise.resolve(),
        }),
    ),
  } as never;
}

function pendingRuntimeStub(publishAfterSubscribe: boolean): KubeRuntime & { apply: Mock } {
  const runtime: KubeRuntime & { apply: Mock } = runtimeStub();
  const namespace: string = kubeNamespaceName('prj_1');
  const name: string = kubeApplicationIdentityName('env_1', 'svc_1');
  return {
    ...runtime,
    read: vi.fn(
      async (): Promise<KubeManifest> =>
        await Promise.resolve(
          publishAfterSubscribe ? readyDeployment(namespace, name) : progressingDeployment(namespace, name),
        ),
    ),
  } as never;
}

function progressingDeployment(namespace: string, name: string): KubeManifest {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { generation: 1, name, namespace },
    status: { availableReplicas: 0, observedGeneration: 1 },
  } as never;
}

function publishReadyDeployment(cache: Map<string, KubeManifest>, listener?: TestObservationListener): void {
  const namespace: string = kubeNamespaceName('prj_1');
  const name: string = kubeApplicationIdentityName('env_1', 'svc_1');
  const event: KubeObservationEvent = { observedAt: new Date(), resource: 'deployments', type: 'relist' };
  cache.set(`deployments/${namespace}/${name}`, readyDeployment(namespace, name));
  listener?.(event);
}

function readyDeployment(namespace: string, name: string): KubeManifest {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { generation: 1, name, namespace },
    status: { availableReplicas: 1, observedGeneration: 1 },
  } as never;
}

function requester(): CompartmentRequester {
  return async function unexpectedRequest<TResult>(): Promise<TResult> {
    await Promise.resolve();
    throw new Error('Unexpected direct request.');
  };
}
