import type {
  DeploymentArtifactCleanupTarget,
  DeploymentReconcileProjection,
  DeploymentReconcileTarget,
  ProjectNetworkPolicyPorts,
  WorkerPersistProductJobResultRequest,
} from '@compartment/contracts';
import {
  kubeApplicationIdentityName,
  kubeNamespaceName,
  projectApplicationManifests,
  type ApplyBundle,
  type KubeDeploymentManifest,
  type KubeManifest,
  type KubeObservation,
  type KubeObservedManifest,
  type KubeRuntime,
  type KubeWorkloadScheduling,
} from '@compartment/kube-runtime';
import type { CompartmentRequester } from '@compartment/sdk';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { reconcileDeploymentTarget as reconcileDeploymentTargetWithKek } from '../src/services/worker-deployment-reconcile.service';
import { encryptTestTenantEnvironment, testTenantSecretsKek } from './tenant-secret-test.fixtures';
import type { WorkerArtifactRegistryConfig } from '../src/worker-artifact-registry.types';

const artifactRegistry: WorkerArtifactRegistryConfig = {
  address: '10.43.199.7:443',
  credentialSigningKey: 'registry-signing-key-with-at-least-32-characters',
  internalAddress: 'registry-internal.example',
  internalUrl: 'http://registry-internal.example',
};

interface ReconcileMocks {
  applyNetworkPolicy: Mock;
  delay: Mock;
  includeApplicationPorts: Mock;
  observeDeploymentReconcile: Mock;
  persistProductJobIntent: Mock;
  projectNetworkPolicyManifests: Mock;
}

async function reconcileDeploymentTarget(
  request: CompartmentRequester,
  kubeRuntime: KubeRuntime,
  reconcileTarget: DeploymentReconcileTarget,
  scheduling?: KubeWorkloadScheduling,
): Promise<DeploymentArtifactCleanupTarget[]> {
  return await reconcileDeploymentTargetWithKek(
    request,
    kubeRuntime,
    reconcileTarget,
    artifactRegistry,
    testTenantSecretsKek,
    scheduling,
  );
}

const mocks: ReconcileMocks = vi.hoisted(
  (): ReconcileMocks => ({
    applyNetworkPolicy: vi.fn(),
    delay: vi.fn(),
    includeApplicationPorts: vi.fn(),
    observeDeploymentReconcile: vi.fn(),
    persistProductJobIntent: vi.fn(),
    projectNetworkPolicyManifests: vi.fn(),
  }),
);

vi.mock('node:timers/promises', (): object => ({ setTimeout: mocks.delay }));
vi.mock('../src/services/worker-network-policy.service', (): object => ({
  applyProjectNetworkPolicies: mocks.applyNetworkPolicy,
  includeApplicationNetworkPolicyPorts: mocks.includeApplicationPorts,
  projectProjectNetworkPolicyManifests: mocks.projectNetworkPolicyManifests,
}));

vi.mock('@compartment/sdk', async (importOriginal: () => Promise<object>): Promise<object> => {
  const original: object = await importOriginal();
  return {
    ...original,
    observeDeploymentReconcile: mocks.observeDeploymentReconcile,
    persistProductJobIntent: mocks.persistProductJobIntent,
  };
});

describe('deployment reconciliation', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    mocks.delay.mockResolvedValue(undefined);
    mocks.applyNetworkPolicy.mockResolvedValue(undefined);
    mocks.includeApplicationPorts.mockImplementation(
      (ports: ProjectNetworkPolicyPorts, applicationPorts: number[]): ProjectNetworkPolicyPorts => ({
        ...ports,
        applicationPorts: [...new Set([...ports.applicationPorts, ...applicationPorts])],
      }),
    );
    mocks.projectNetworkPolicyManifests.mockImplementation(
      (_projectId: string, ports: ProjectNetworkPolicyPorts): KubeManifest[] => [
        {
          apiVersion: 'networking.k8s.io/v1',
          kind: 'NetworkPolicy',
          metadata: { name: 'application-ingress' },
          spec: { ingress: [{ ports: ports.applicationPorts.map((port: number): object => ({ port })) }] },
        },
      ],
    );
    mocks.persistProductJobIntent.mockResolvedValue({ result: null });
    mocks.observeDeploymentReconcile.mockResolvedValue({ applied: true, cleanupArtifacts: [] });
  });

  it('does not start rollout when the release Job fails', async (): Promise<void> => {
    const runtime: KubeRuntime & { apply: Mock } = runtimeStub();
    mocks.persistProductJobIntent.mockResolvedValue({
      result: productJobResult('failed', 'release exited 17'),
    });

    await reconcileDeploymentTarget(requester(), runtime, target(projection('bin/migrate')));

    expect(runtime.apply).not.toHaveBeenCalled();
    expect(mocks.observeDeploymentReconcile).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ message: 'Release Job failed: release exited 17', observation: 'failed', revision: 0 }),
    );
  });

  it('recovers after restart from durable desired before apply', async (): Promise<void> => {
    const runtime: KubeRuntime & { apply: Mock } = runtimeStub();

    await reconcileDeploymentTarget(requester(), runtime, target(projection('bin/migrate')));

    expect(runtime.apply).not.toHaveBeenCalled();
    expect(mocks.persistProductJobIntent).toHaveBeenCalledOnce();

    mocks.persistProductJobIntent.mockResolvedValue({ result: productJobResult('succeeded', 'release complete') });
    await reconcileDeploymentTarget(requester(), runtime, target(projection('bin/migrate')));

    expect(runtime.apply).toHaveBeenCalledOnce();
    const bundle: ApplyBundle = runtime.apply.mock.calls[0]?.[0] as ApplyBundle;
    expect(bundle.objects.some((object: KubeManifest): boolean => object.kind === 'Deployment')).toBe(true);
    const deployment: KubeDeploymentManifest | undefined = bundle.objects.find(
      (object: KubeManifest): object is KubeDeploymentManifest => object.kind === 'Deployment',
    );
    expect(deployment?.spec?.template.spec.containers[0]?.image).toBe(
      `10.43.199.7:443/projects/prj_1/services/svc_1@sha256:${'a'.repeat(64)}`,
    );
    expect(bundle.objects.find((object: KubeManifest): boolean => object.kind === 'Secret')?.stringData).toEqual({
      PORT: '3000',
    });
    expect(mocks.observeDeploymentReconcile).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'pending', revision: 0 }),
    );
  });

  it('applies the current application port policy before the Deployment in the same bundle', async (): Promise<void> => {
    const runtime: KubeRuntime & { apply: Mock; read: Mock } = pendingRuntimeStub(true);
    const staleTarget: DeploymentReconcileTarget = {
      ...target(projection(null)),
      networkPolicy: { applicationPorts: [], resourcePorts: [5432] },
    };

    await reconcileDeploymentTarget(requester(), runtime, staleTarget);

    expect(runtime.apply).toHaveBeenCalledOnce();
    const bundle: ApplyBundle = runtime.apply.mock.calls[0]?.[0] as ApplyBundle;
    const policyIndex: number = bundle.objects.findIndex(
      (object: KubeManifest): boolean => object.kind === 'NetworkPolicy',
    );
    const deploymentIndex: number = bundle.objects.findIndex(
      (object: KubeManifest): boolean => object.kind === 'Deployment',
    );
    expect(bundle.objects.map((object: KubeManifest): string => object.kind)).toContain('NetworkPolicy');
    expect(policyIndex).toBeGreaterThanOrEqual(0);
    expect(policyIndex).toBeLessThan(deploymentIndex);
    expect(bundle.objects[policyIndex]?.spec).toEqual({ ingress: [{ ports: [{ port: 3000 }] }] });
    expect(runtime.read).not.toHaveBeenCalled();
    expect(mocks.observeDeploymentReconcile).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'pending', revision: 0 }),
    );
    expect(mocks.observeDeploymentReconcile).not.toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'ready' }),
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

    await reconcileAt('2026-07-12T12:00:20.000Z', runtime, pendingTarget);

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

  it('allows a 13-second cold pull followed by readiness inside the 10-second application window', async (): Promise<void> => {
    const namespace: string = kubeNamespaceName('prj_1');
    const name: string = kubeApplicationIdentityName('env_1', 'svc_1');
    const runtime: KubeRuntime & { read: Mock } = pendingRuntimeStub(false, [
      applicationPod('dep_candidate', '2026-07-12T12:00:13.000Z'),
    ]);
    runtime.read
      .mockResolvedValueOnce(progressingDeployment(namespace, name))
      .mockResolvedValue(readyDeployment(namespace, name));
    const pendingTarget: DeploymentReconcileTarget = pendingTargetWithReadinessTimeout(10_000);

    await reconcileAt('2026-07-12T12:00:13.000Z', runtime, pendingTarget);
    expect(mocks.observeDeploymentReconcile).not.toHaveBeenCalled();

    await reconcileAt('2026-07-12T12:00:22.000Z', runtime, pendingTarget);
    expect(mocks.observeDeploymentReconcile).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'ready', revision: 0 }),
    );
  });

  it('fails an already-running application that remains unready beyond its 10-second window', async (): Promise<void> => {
    const runtime: KubeRuntime = pendingRuntimeStub(false, [
      applicationPod('dep_candidate', '2026-07-12T12:00:00.000Z'),
    ]);

    await reconcileAt('2026-07-12T12:00:10.001Z', runtime, pendingTargetWithReadinessTimeout(10_000));

    expect(mocks.observeDeploymentReconcile).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'failed', revision: 0 }),
    );
  });

  it('gives an application that starts near the infrastructure deadline its full readiness window', async (): Promise<void> => {
    const namespace: string = kubeNamespaceName('prj_1');
    const name: string = kubeApplicationIdentityName('env_1', 'svc_1');
    const runtime: KubeRuntime & { read: Mock } = pendingRuntimeStub(false, [
      applicationPod('dep_candidate', '2026-07-12T12:00:44.000Z'),
    ]);
    runtime.read.mockResolvedValue(readyDeployment(namespace, name));

    await reconcileAt('2026-07-12T12:00:53.000Z', runtime, pendingTargetWithReadinessTimeout(10_000));

    expect(mocks.observeDeploymentReconcile).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'ready', revision: 0 }),
    );
  });

  it('fails a container that never starts only at the infrastructure deadline', async (): Promise<void> => {
    const runtime: KubeRuntime = pendingRuntimeStub(false, [applicationPod('dep_candidate', null)]);
    const pendingTarget: DeploymentReconcileTarget = pendingTargetWithReadinessTimeout(10_000);

    await reconcileAt('2026-07-12T12:00:44.999Z', runtime, pendingTarget);
    expect(mocks.observeDeploymentReconcile).not.toHaveBeenCalled();

    await reconcileAt('2026-07-12T12:00:45.000Z', runtime, pendingTarget);
    expect(mocks.observeDeploymentReconcile).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'failed', revision: 0 }),
    );
  });

  it('does not start the application deadline from an old revision Pod', async (): Promise<void> => {
    const runtime: KubeRuntime = pendingRuntimeStub(false, [
      applicationPod('dep_old', '2026-07-12T12:00:00.000Z'),
      applicationPod('dep_candidate', null),
    ]);

    await reconcileAt('2026-07-12T12:00:20.000Z', runtime, pendingTargetWithReadinessTimeout(10_000));

    expect(mocks.observeDeploymentReconcile).not.toHaveBeenCalled();
  });

  it('rejects a container that first enters Running after the infrastructure deadline', async (): Promise<void> => {
    const runtime: KubeRuntime = pendingRuntimeStub(false, [
      applicationPod('dep_candidate', '2026-07-12T12:00:45.001Z'),
    ]);

    await reconcileAt('2026-07-12T12:00:45.001Z', runtime, pendingTargetWithReadinessTimeout(10_000));

    expect(mocks.observeDeploymentReconcile).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'failed', revision: 0 }),
    );
  });

  it('does not let restart timestamps extend the application deadline past the infrastructure bound', async (): Promise<void> => {
    const runtime: KubeRuntime = pendingRuntimeStub(false, [
      applicationPod('dep_candidate', '2026-07-12T12:00:54.000Z', '2026-07-12T12:00:53.000Z'),
    ]);
    const pendingTarget: DeploymentReconcileTarget = pendingTargetWithReadinessTimeout(10_000);

    await reconcileAt('2026-07-12T12:00:55.000Z', runtime, pendingTarget);

    expect(mocks.observeDeploymentReconcile).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'failed', revision: 0 }),
    );
  });

  it('recovers after restart between pending persistence and Ready', async (): Promise<void> => {
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
    networkPolicy: { applicationPorts: [3000], resourcePorts: [5432] },
    revision: 0,
    rolloutStartedAt: '2026-07-12T12:00:00.000Z',
    state: 'desired',
  };
}

function productJobResult(
  status: 'failed' | 'succeeded' | 'timed-out',
  logs: string,
): WorkerPersistProductJobResultRequest {
  return {
    completedAt: '2026-07-12T12:00:00.000Z',
    exitCode: status === 'succeeded' ? 0 : 17,
    identityId: 'dep_candidate',
    jobClass: 'release',
    jobName: 'release-dep-candidate',
    logs,
    podName: 'release-dep-candidate-pod',
    status,
  };
}

function projection(releaseCommand: string | null): DeploymentReconcileProjection {
  return {
    containerPorts: [3000],
    deploymentId: 'dep_candidate',
    environmentId: 'env_1',
    environmentName: 'production',
    env: encryptTestTenantEnvironment({ PORT: '3000' }),
    image: `10.43.250.250:443/projects/prj_1/services/svc_1@sha256:${'a'.repeat(64)}`,
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
    apply: vi.fn(async (bundle: ApplyBundle): Promise<KubeManifest[]> => await Promise.resolve(bundle.objects)),
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
    observe: vi.fn(async (): Promise<KubeObservation> => await Promise.resolve(kubeObservation([]))),
    read: vi.fn(
      async (): Promise<KubeManifest> =>
        await Promise.resolve(
          ready ? readyDeployment(namespace, name) : progressingDeployment(namespace, name, progressDeadlineExceeded),
        ),
    ),
  } as never;
}

function pendingRuntimeStub(
  publishAfterSubscribe: boolean,
  pods: KubeObservedManifest[] = [],
): KubeRuntime & { apply: Mock; observe: Mock; read: Mock } {
  const namespace: string = kubeNamespaceName('prj_1');
  const name: string = kubeApplicationIdentityName('env_1', 'svc_1');
  const applied: KubeManifest = readyDeployment(namespace, name);
  return {
    apply: vi.fn(async (): Promise<KubeManifest[]> => await Promise.resolve([applied])),
    observe: vi.fn(async (): Promise<KubeObservation> => await Promise.resolve(kubeObservation(pods))),
    read: vi.fn(
      async (): Promise<KubeManifest> =>
        await Promise.resolve(
          publishAfterSubscribe ? readyDeployment(namespace, name) : progressingDeployment(namespace, name),
        ),
    ),
  } as never;
}

function kubeObservation(pods: KubeObservedManifest[]): KubeObservation {
  return {
    cache: new Map(
      pods.map((pod: KubeObservedManifest, index: number): [string, KubeObservedManifest] => [
        `pods/cpt-prj/${index.toString()}`,
        pod,
      ]),
    ),
    stop: vi.fn(async (): Promise<void> => await Promise.resolve()),
  } as never;
}

function pendingTargetWithReadinessTimeout(timeoutMs: number): DeploymentReconcileTarget {
  const candidate: DeploymentReconcileProjection = {
    ...projection(null),
    readiness: { path: '/healthz', timeoutMs, type: 'http' },
  };
  return { ...target(candidate), state: 'pending' };
}

async function reconcileAt(now: string, runtime: KubeRuntime, pendingTarget: DeploymentReconcileTarget): Promise<void> {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(now);
    await reconcileDeploymentTarget(requester(), runtime, pendingTarget);
  } finally {
    vi.useRealTimers();
  }
}

function applicationPod(
  deploymentId: string,
  startedAt: string | null,
  previousStartedAt?: string,
): KubeObservedManifest {
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { labels: { 'compartment.dev/deployment-id': deploymentId } },
    status: {
      containerStatuses: [
        {
          ...(previousStartedAt === undefined ? {} : { lastState: { terminated: { startedAt: previousStartedAt } } }),
          name: applicationContainerName(deploymentId),
          state: startedAt === null ? { waiting: { reason: 'ContainerCreating' } } : { running: { startedAt } },
        },
      ],
    },
  };
}

function applicationContainerName(deploymentId: string): string {
  return projectedApplicationDeployment(deploymentId).spec!.template.spec.containers[0]!.name;
}

function projectedApplicationDeployment(deploymentId: string = 'dep_candidate'): KubeDeploymentManifest {
  return projectApplicationManifests({
    ...projection(null),
    deploymentId,
    env: { PORT: '3000' },
  }).find((manifest: KubeManifest): manifest is KubeDeploymentManifest => manifest.kind === 'Deployment')!;
}

function progressingDeployment(
  namespace: string,
  name: string,
  progressDeadlineExceeded: boolean = false,
  uid: string = 'applied-uid',
): KubeManifest {
  const deployment: KubeDeploymentManifest = projectedApplicationDeployment();
  return {
    ...deployment,
    metadata: { ...deployment.metadata, generation: 1, name, namespace, uid },
    status: {
      availableReplicas: 0,
      conditions: progressDeadlineExceeded
        ? [{ reason: 'ProgressDeadlineExceeded', status: 'False', type: 'Progressing' }]
        : [],
      observedGeneration: 1,
    },
  };
}

function readyDeployment(
  namespace: string,
  name: string,
  uid: string = 'applied-uid',
  generation: number = 1,
): KubeManifest {
  const deployment: KubeDeploymentManifest = projectedApplicationDeployment();
  return {
    ...deployment,
    metadata: { ...deployment.metadata, generation, name, namespace, uid },
    status: { availableReplicas: 1, observedGeneration: generation, replicas: 1, updatedReplicas: 1 },
  };
}

function requester(): CompartmentRequester {
  return async function unexpectedRequest<TResult>(): Promise<TResult> {
    await Promise.resolve();
    throw new Error('Unexpected direct request.');
  };
}
