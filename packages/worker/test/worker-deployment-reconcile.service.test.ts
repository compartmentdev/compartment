import type {
  DeploymentArtifactCleanupTarget,
  DeploymentReconcileProjection,
  DeploymentReconcileTarget,
  ProjectNetworkPolicyPorts,
  WorkerObserveDeploymentReconcileRequest,
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
import { DeploymentRolloutStartTracker } from '../src/services/worker-deployment-rollout-start-tracker.service';
import { encryptTestTenantEnvironment, testTenantSecretsKek } from './tenant-secret-test.fixtures';
import type { WorkerArtifactRegistryConfig } from '../src/worker-artifact-registry.types';
import type {
  AppliedGateContainer,
  ApplyMockCall,
  ApplyReadRuntime,
  DeleteRuntime,
  ReconcileMocks,
  RecoveryRuntime,
} from './worker-deployment-reconcile.service.test.types';

const artifactRegistry: WorkerArtifactRegistryConfig = {
  address: '10.43.199.7:443',
  credentialSigningKey: 'registry-signing-key-with-at-least-32-characters',
  internalAddress: 'registry-internal.example',
  internalUrl: 'http://registry-internal.example',
};
const infrastructureTimeoutMs: number = 600_000;
const workerImage: string = 'compartment-worker@sha256:worker';
let rolloutStarts: DeploymentRolloutStartTracker;

async function reconcileDeploymentTarget(
  request: CompartmentRequester,
  kubeRuntime: KubeRuntime,
  reconcileTarget: DeploymentReconcileTarget,
  scheduling?: KubeWorkloadScheduling,
  configuredInfrastructureTimeoutMs: number = infrastructureTimeoutMs,
): Promise<DeploymentArtifactCleanupTarget[]> {
  return await reconcileDeploymentTargetWithKek(
    request,
    kubeRuntime,
    reconcileTarget,
    artifactRegistry,
    testTenantSecretsKek,
    configuredInfrastructureTimeoutMs,
    workerImage,
    rolloutStarts,
    scheduling,
  );
}

const mocks: ReconcileMocks = vi.hoisted(
  (): ReconcileMocks => ({
    applyNetworkPolicy: vi.fn(),
    delay: vi.fn(),
    observeDeploymentReconcile: vi.fn(),
    persistProductJobIntent: vi.fn(),
    projectNetworkPolicyManifests: vi.fn(),
  }),
);

vi.mock('node:timers/promises', (): object => ({ setTimeout: mocks.delay }));
vi.mock('../src/services/worker-network-policy.service', (): object => ({
  applyProjectNetworkPolicies: mocks.applyNetworkPolicy,
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
    rolloutStarts = new DeploymentRolloutStartTracker();
    mocks.delay.mockResolvedValue(undefined);
    mocks.applyNetworkPolicy.mockResolvedValue(undefined);
    mocks.projectNetworkPolicyManifests.mockImplementation(
      (projectId: string, ports: ProjectNetworkPolicyPorts): KubeManifest[] => [
        {
          apiVersion: 'networking.k8s.io/v1',
          kind: 'NetworkPolicy',
          metadata: { labels: { 'compartment.dev/project-id': projectId }, name: 'application-ingress' },
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

  it('persists a clear failure when Kubernetes rejects apply because project quota is exhausted', async (): Promise<void> => {
    const runtime: KubeRuntime & { apply: Mock } = runtimeStub();
    runtime.apply.mockRejectedValue(
      kubernetesForbiddenError(
        'pods "checkout" is forbidden: exceeded quota: project-quota, requested: limits.cpu=2, used: limits.cpu=7, limited: limits.cpu=8',
      ),
    );

    await reconcileDeploymentTarget(requester(), runtime, target(projection(null)));

    expect(persistedObservation()).toMatchObject({
      deploymentId: 'dep_candidate',
      message:
        'Kubernetes resource quota exceeded. Reduce resource usage or ask an operator to increase the tenant quota. pods "checkout" is forbidden: exceeded quota: project-quota, requested: limits.cpu=2, used: limits.cpu=7, limited: limits.cpu=8',
      observation: 'failed',
      revision: 0,
    });
  });

  it('does not misclassify an arbitrary Kubernetes forbidden error as quota exhaustion', async (): Promise<void> => {
    const runtime: KubeRuntime & { apply: Mock } = runtimeStub();
    const error: Error = kubernetesForbiddenError('deployments.apps "checkout" is forbidden: RBAC denied');
    runtime.apply.mockRejectedValue(error);

    await expect(reconcileDeploymentTarget(requester(), runtime, target(projection(null)))).rejects.toBe(error);

    expect(mocks.observeDeploymentReconcile).not.toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'failed' }),
    );
  });

  it('gates every Pod it projects for a service that declares a resource', async (): Promise<void> => {
    const runtime: ApplyReadRuntime = pendingRuntimeStub(true);
    const connected: DeploymentReconcileTarget = target({
      ...projection(null),
      resourceEndpoints: [{ port: 5432, resourceId: 'res_db', timeoutMs: 30_000 }],
    });

    await reconcileDeploymentTarget(requester(), runtime, connected);

    const gate: AppliedGateContainer | undefined = appliedGate(runtime);
    expect(gate?.image).toBe(workerImage);
    expect(gate?.env[0]?.value).toContain('"port":5432');
    expect(gate?.env[0]?.value).toContain('"timeoutMs":30000');
  });

  it('projects no gate for a service that declares no resource', async (): Promise<void> => {
    const runtime: ApplyReadRuntime = pendingRuntimeStub(true);

    await reconcileDeploymentTarget(requester(), runtime, target(projection(null)));

    expect(appliedGate(runtime)).toBeUndefined();
  });

  it('applies the claimed port policy before the Deployment in the same bundle', async (): Promise<void> => {
    const runtime: ApplyReadRuntime = pendingRuntimeStub(true);
    const claimedTarget: DeploymentReconcileTarget = {
      ...target(projection(null)),
      networkPolicy: { applicationPorts: [8080], resourcePorts: [5432] },
    };

    await reconcileDeploymentTarget(requester(), runtime, claimedTarget);

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
    expect(bundle.objects[policyIndex]?.spec).toEqual({ ingress: [{ ports: [{ port: 8080 }] }] });
    expect(mocks.projectNetworkPolicyManifests).toHaveBeenCalledWith('prj_1', {
      applicationPorts: [8080],
      resourcePorts: [5432],
    });
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
    const runtime: ApplyReadRuntime = activeRuntimeStub(false);
    const activeTarget: DeploymentReconcileTarget = { ...target(projection(null)), state: 'active' };

    await reconcileDeploymentTarget(requester(), runtime, activeTarget);

    expect(runtime.read).toHaveBeenCalledTimes(6);
    expect(mocks.observeDeploymentReconcile).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'pending', revision: 0 }),
    );
  });

  it('demotes a persistently deadline-exceeded active Deployment only after the grace reads', async (): Promise<void> => {
    const runtime: ApplyReadRuntime = activeRuntimeStub(false, true);
    const activeTarget: DeploymentReconcileTarget = { ...target(projection(null)), state: 'active' };

    await reconcileDeploymentTarget(requester(), runtime, activeTarget);

    expect(runtime.read).toHaveBeenCalledTimes(6);
    expect(mocks.observeDeploymentReconcile).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'pending', revision: 0 }),
    );
  });

  it('restarts a deadline-exceeded active Deployment without terminally failing its recovery claim', async (): Promise<void> => {
    const runtime: KubeRuntime & { apply: Mock; delete: Mock } = activeRuntimeStub(false, true);
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

  it('does not restart an unhealthy active Deployment at the absolute rollout deadline', async (): Promise<void> => {
    const runtime: DeleteRuntime = activeRuntimeStub(false, true);
    const candidate: DeploymentReconcileProjection = projection(null);
    const pendingTarget: DeploymentReconcileTarget = {
      ...target(candidate),
      active: candidate,
      state: 'pending',
    };

    await reconcileAt('2026-07-12T12:11:00.000Z', runtime, pendingTarget);

    expect(runtime.delete).not.toHaveBeenCalled();
    expect(mocks.observeDeploymentReconcile).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'failed', revision: 0 }),
    );
  });

  it('fails immediately when the Deployment controller reports exhausted project quota', async (): Promise<void> => {
    const namespace: string = kubeNamespaceName('prj_1');
    const name: string = kubeApplicationIdentityName('env_1', 'svc_1');
    const runtime: KubeRuntime & { read: Mock } = pendingRuntimeStub(false);
    runtime.read.mockResolvedValue(quotaFailedDeployment(namespace, name));
    const pendingTarget: DeploymentReconcileTarget = { ...target(projection(null)), state: 'pending' };

    await reconcileAt('2026-07-12T12:00:01.000Z', runtime, pendingTarget);

    expect(persistedObservation()).toMatchObject({
      deploymentId: 'dep_candidate',
      message:
        'Kubernetes resource quota exceeded. Reduce resource usage or ask an operator to increase the tenant quota. pods "checkout" is forbidden: exceeded quota: project-quota, requested: requests.memory=256Mi, used: requests.memory=2Gi, limited: requests.memory=2Gi',
      observation: 'failed',
      revision: 0,
    });
  });

  it('deletes a Capsule-rejected candidate before persisting terminal failure', async (): Promise<void> => {
    const namespace: string = kubeNamespaceName('prj_1');
    const name: string = kubeApplicationIdentityName('env_1', 'svc_1');
    const message: string =
      'admission webhook "calculation.custom-quotas.validating.projectcapsule.dev" denied the request: creating resource exceeds limit for GlobalCustomQuota "org-quota-limits-cpu" (requested=2, currentUsed=9, available=0, limit=8)';
    const runtime: KubeRuntime & { delete: Mock; read: Mock } = pendingRuntimeStub(false);
    runtime.read.mockResolvedValue(quotaFailedDeployment(namespace, name, message));
    const pendingTarget: DeploymentReconcileTarget = { ...target(projection(null)), state: 'pending' };

    await reconcileAt('2026-07-12T12:00:01.000Z', runtime, pendingTarget);

    const deleted: KubeManifest[] = runtime.delete.mock.calls[0]?.[0] as KubeManifest[];
    expect(deleted.map((object: KubeManifest): string => object.kind)).toEqual(['Secret', 'Deployment', 'Service']);
    expect(deleted).not.toContainEqual(expect.objectContaining({ kind: 'PersistentVolumeClaim' }));
    expect(runtime.delete.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.observeDeploymentReconcile.mock.invocationCallOrder[0]!,
    );
  });

  it('starts a fresh application window after restarting an unhealthy active Deployment', async (): Promise<void> => {
    const namespace: string = kubeNamespaceName('prj_1');
    const name: string = kubeApplicationIdentityName('env_1', 'svc_1');
    const runtime: KubeRuntime & { delete: Mock; observe: Mock; read: Mock } = pendingRuntimeStub(false);
    runtime.delete = vi.fn(async (): Promise<void> => await Promise.resolve());
    runtime.observe
      .mockResolvedValueOnce(kubeObservation([applicationPod('dep_candidate', '2026-07-12T11:00:00.000Z')]))
      .mockResolvedValueOnce(kubeObservation([applicationPod('dep_candidate', '2026-07-12T12:00:20.000Z')]))
      .mockResolvedValueOnce(kubeObservation([applicationPod('dep_candidate', '2026-07-12T12:00:20.000Z')]));
    runtime.read
      .mockResolvedValueOnce(progressingDeployment(namespace, name))
      .mockResolvedValueOnce(progressingDeployment(namespace, name))
      .mockResolvedValue(readyDeployment(namespace, name));
    const candidate: DeploymentReconcileProjection = projection(null);
    const pendingTarget: DeploymentReconcileTarget = { ...target(candidate), active: candidate, state: 'pending' };

    await reconcileAt('2026-07-12T12:00:20.000Z', runtime, pendingTarget);
    await reconcileAt('2026-07-12T12:00:30.000Z', runtime, pendingTarget);
    expect(mocks.observeDeploymentReconcile).not.toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'failed' }),
    );

    await reconcileAt('2026-07-12T12:00:40.000Z', runtime, pendingTarget);

    expect(runtime.delete).toHaveBeenCalledTimes(1);
    expect(mocks.observeDeploymentReconcile).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'ready', revision: 0 }),
    );
  });

  it('fails an unhealthy active Deployment after its single recovery restart window expires', async (): Promise<void> => {
    const runtime: KubeRuntime & { delete: Mock; observe: Mock } = pendingRuntimeStub(false);
    runtime.delete = vi.fn(async (): Promise<void> => await Promise.resolve());
    runtime.observe
      .mockResolvedValueOnce(kubeObservation([applicationPod('dep_candidate', '2026-07-12T11:00:00.000Z')]))
      .mockResolvedValueOnce(kubeObservation([applicationPod('dep_candidate', '2026-07-12T12:00:20.000Z')]))
      .mockResolvedValueOnce(kubeObservation([applicationPod('dep_candidate', '2026-07-12T12:00:20.000Z')]));
    const candidate: DeploymentReconcileProjection = projection(null);
    const pendingTarget: DeploymentReconcileTarget = { ...target(candidate), active: candidate, state: 'pending' };

    await reconcileAt('2026-07-12T12:00:20.000Z', runtime, pendingTarget);
    await reconcileAt('2026-07-12T12:01:20.000Z', runtime, pendingTarget);
    await reconcileAt('2026-07-12T12:01:20.001Z', runtime, pendingTarget);

    expect(runtime.delete).toHaveBeenCalledTimes(1);
    expect(mocks.observeDeploymentReconcile).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'failed', revision: 0 }),
    );
  });

  it('restores the active application and its ingress ports after a candidate rollout fails', async (): Promise<void> => {
    const candidateReplicaSet: KubeObservedManifest = {
      apiVersion: 'apps/v1',
      kind: 'ReplicaSet',
      metadata: { labels: { 'compartment.dev/deployment-id': 'dep_candidate' }, name: 'candidate-rs' },
    };
    const runtime: KubeRuntime & { apply: Mock; delete: Mock; observe: Mock } = pendingRuntimeStub(false, [
      applicationPod('dep_candidate', '2026-07-12T11:00:00.000Z'),
    ]);
    runtime.observe.mockResolvedValueOnce(
      kubeObservation([applicationPod('dep_candidate', '2026-07-12T11:00:00.000Z')]),
    );
    runtime.observe.mockResolvedValueOnce(kubeObservation([candidateReplicaSet]));
    const candidate: DeploymentReconcileProjection = projection(null);
    const active: DeploymentReconcileProjection = {
      ...candidate,
      containerPorts: [8080],
      deploymentId: 'dep_active',
      image: `10.43.250.250:443/projects/prj_active/services/svc_1@sha256:${'b'.repeat(64)}`,
      imagePullSecretId: 'prj_active',
      namespaceId: 'prj_active',
      projectId: 'prj_active',
      projectName: 'active-checkout',
      secretId: 'dep_active',
    };
    const pendingTarget: DeploymentReconcileTarget = {
      ...target(candidate),
      active,
      networkPolicy: { applicationPorts: [9090], resourcePorts: [5432] },
      state: 'pending',
    };

    await reconcileAt('2026-07-12T12:10:00.000Z', runtime, pendingTarget);

    const applyCalls: ApplyMockCall[] = runtime.apply.mock.calls as ApplyMockCall[];
    const recovery: ApplyBundle | undefined = applyCalls
      .map((call: ApplyMockCall): ApplyBundle => call[0])
      .find((bundle: ApplyBundle): boolean => bundle.force === true);
    const restoredDeployment: KubeDeploymentManifest | undefined = recovery?.objects.find(
      (object: KubeManifest): object is KubeDeploymentManifest => object.kind === 'Deployment',
    );
    const restoredPolicy: KubeManifest | undefined = recovery?.objects.find(
      (object: KubeManifest): boolean => object.kind === 'NetworkPolicy',
    );
    expect(restoredDeployment?.spec?.template.spec.containers[0]?.image).toBe(
      `10.43.199.7:443/projects/prj_active/services/svc_1@sha256:${'b'.repeat(64)}`,
    );
    expect(restoredDeployment?.spec?.template.spec.containers[0]?.ports).toEqual([
      { containerPort: 8080, name: 'http', protocol: 'TCP' },
    ]);
    expect(restoredPolicy?.spec).toEqual({ ingress: [{ ports: [{ port: 9090 }] }] });
    expect(mocks.projectNetworkPolicyManifests).toHaveBeenCalledWith('prj_active', {
      applicationPorts: [9090],
      resourcePorts: [5432],
    });
    const cleanupInput: { labels: Record<string, string>; namespace: string; resources: string[] } =
      runtime.observe.mock.calls.at(-1)?.[0] as never;
    expect(cleanupInput).toMatchObject({
      labels: {
        'compartment.dev/deployment-id': 'dep_candidate',
        'compartment.dev/environment-id': 'env_1',
        'compartment.dev/organization-id': 'org_1',
        'compartment.dev/project-id': 'prj_1',
        'compartment.dev/service-id': 'svc_1',
      },
      namespace: kubeNamespaceName('prj_1'),
      resources: ['replicasets'],
    });
    const deleted: KubeManifest[] = runtime.delete.mock.calls.at(-1)?.[0] as KubeManifest[];
    expect(deleted.map((object: KubeManifest): string => object.kind)).toEqual(['Secret', 'ReplicaSet']);
  });

  it('preserves the single recovery restart after cross-deployment tracker pruning', async (): Promise<void> => {
    const recoveryRuntime: RecoveryRuntime = recoveryRuntimeStub();
    const candidate: DeploymentReconcileProjection = projection(null);
    const recoveryTarget: DeploymentReconcileTarget = {
      ...target(candidate),
      active: candidate,
      state: 'pending',
    };

    await reconcileAt('2026-07-12T12:00:20.000Z', recoveryRuntime, recoveryTarget);

    const otherCandidate: DeploymentReconcileProjection = {
      ...candidate,
      deploymentId: 'dep_other',
      secretId: 'dep_other',
    };
    const otherRuntime: KubeRuntime = pendingRuntimeStub(false, [applicationPod('dep_other', null)]);
    await reconcileAt('2026-07-12T12:12:00.000Z', otherRuntime, {
      ...target(otherCandidate),
      rolloutStartedAt: '2026-07-12T12:12:00.000Z',
      state: 'pending',
    });
    await reconcileAt('2026-07-12T12:12:00.001Z', recoveryRuntime, recoveryTarget);

    expect(recoveryRuntime.delete).toHaveBeenCalledTimes(1);
    expect(mocks.observeDeploymentReconcile).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ deploymentId: 'dep_candidate', observation: 'failed' }),
    );
  });

  it('preserves the single recovery restart after the worker process restarts', async (): Promise<void> => {
    const runtime: RecoveryRuntime = recoveryRuntimeStub();
    const candidate: DeploymentReconcileProjection = projection(null);
    const pendingTarget: DeploymentReconcileTarget = {
      ...target(candidate),
      active: candidate,
      state: 'pending',
    };

    await reconcileAt('2026-07-12T12:00:20.000Z', runtime, pendingTarget);
    rolloutStarts = new DeploymentRolloutStartTracker();
    await reconcileAt('2026-07-12T12:01:20.000Z', runtime, pendingTarget);

    expect(runtime.delete).toHaveBeenCalledTimes(1);
    const pendingApplyAfterRestart: ApplyBundle | undefined = (runtime.apply.mock.calls as ApplyMockCall[])
      .map((call: ApplyMockCall): ApplyBundle => call[0])
      .find(
        (bundle: ApplyBundle): boolean =>
          bundle.force !== true &&
          bundle.objects.some(
            (object: KubeManifest): boolean =>
              object.kind === 'Deployment' &&
              object.metadata?.annotations?.['compartment.dev/recovery-restarted'] === 'true',
          ),
      );
    expect(
      pendingApplyAfterRestart?.objects.find((object: KubeManifest): boolean => object.kind === 'Deployment')?.metadata
        ?.annotations?.['compartment.dev/recovery-restarted'],
    ).toBe('true');
    expect(mocks.observeDeploymentReconcile).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'failed', revision: 0 }),
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

  it('deletes an unready first deployment before persisting failure so its quota is released', async (): Promise<void> => {
    const runtime = pendingRuntimeStub(false, [applicationPod('dep_candidate', '2026-07-12T12:00:00.000Z')]);

    await reconcileAt('2026-07-12T12:00:10.001Z', runtime, pendingTargetWithReadinessTimeout(10_000));

    const deleted: KubeManifest[] = runtime.delete.mock.calls[0]?.[0] as KubeManifest[];
    expect(deleted.map((object: KubeManifest): string => object.kind)).toEqual(['Secret', 'Deployment', 'Service']);
    expect(runtime.delete.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.observeDeploymentReconcile.mock.invocationCallOrder[0]!,
    );
  });

  it('gives a container that starts just before the infrastructure deadline its full maximum readiness window', async (): Promise<void> => {
    const runtime: KubeRuntime = pendingRuntimeStub(false, [
      applicationPod('dep_candidate', '2026-07-12T12:09:59.999Z'),
    ]);
    const pendingTarget: DeploymentReconcileTarget = pendingTargetWithReadinessTimeout(300_000);

    await reconcileAt('2026-07-12T12:14:59.998Z', runtime, pendingTarget);
    expect(mocks.observeDeploymentReconcile).not.toHaveBeenCalled();

    await reconcileAt('2026-07-12T12:14:59.999Z', runtime, pendingTarget);
    expect(mocks.observeDeploymentReconcile).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'failed', revision: 0 }),
    );
  });

  it('keeps a container that never starts progressing at 45 seconds and fails only at 10 minutes', async (): Promise<void> => {
    const runtime: KubeRuntime = pendingRuntimeStub(false, [applicationPod('dep_candidate', null)]);
    const pendingTarget: DeploymentReconcileTarget = pendingTargetWithReadinessTimeout(10_000);

    await reconcileAt('2026-07-12T12:00:45.000Z', runtime, pendingTarget);
    expect(mocks.observeDeploymentReconcile).not.toHaveBeenCalled();

    await reconcileAt('2026-07-12T12:09:59.999Z', runtime, pendingTarget);
    expect(mocks.observeDeploymentReconcile).not.toHaveBeenCalled();

    await reconcileAt('2026-07-12T12:10:00.000Z', runtime, pendingTarget);
    expect(mocks.observeDeploymentReconcile).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'failed', revision: 0 }),
    );
  });

  it('uses the configured infrastructure timeout for a container that never starts', async (): Promise<void> => {
    const runtime: KubeRuntime & { delete: Mock } = pendingRuntimeStub(false, [applicationPod('dep_candidate', null)]);
    const pendingTarget: DeploymentReconcileTarget = pendingTargetWithReadinessTimeout(10_000);

    await reconcileAt('2026-07-12T12:01:59.999Z', runtime, pendingTarget, 120_000);
    expect(mocks.observeDeploymentReconcile).not.toHaveBeenCalled();
    expect(runtime.delete).not.toHaveBeenCalled();

    await reconcileAt('2026-07-12T12:02:00.000Z', runtime, pendingTarget, 120_000);
    expect(mocks.observeDeploymentReconcile).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'failed', revision: 0 }),
    );
    const deleted: KubeManifest[] = runtime.delete.mock.calls[0]?.[0] as KubeManifest[];
    expect(deleted.map((object: KubeManifest): string => object.kind)).toEqual(['Secret', 'Deployment', 'Service']);
  });

  it('leaves timeout failure unpersisted when first-deploy cleanup fails', async (): Promise<void> => {
    const runtime: KubeRuntime & { delete: Mock } = pendingRuntimeStub(false, [applicationPod('dep_candidate', null)]);
    runtime.delete.mockRejectedValue(new Error('cleanup failed'));

    await expect(
      reconcileAt('2026-07-12T12:02:00.000Z', runtime, pendingTargetWithReadinessTimeout(10_000), 120_000),
    ).rejects.toThrow('cleanup failed');

    expect(mocks.observeDeploymentReconcile).not.toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'failed' }),
    );
  });

  it('does not cleanup or persist failure when the Kubernetes read fails', async (): Promise<void> => {
    const runtime: KubeRuntime & { delete: Mock; read: Mock } = pendingRuntimeStub(false);
    runtime.read.mockRejectedValue(new Error('Kubernetes transport failed'));

    await expect(
      reconcileAt('2026-07-12T12:10:00.000Z', runtime, pendingTargetWithReadinessTimeout(10_000)),
    ).rejects.toThrow('Kubernetes transport failed');

    expect(runtime.delete).not.toHaveBeenCalled();
    expect(mocks.observeDeploymentReconcile).not.toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'failed' }),
    );
  });

  it('cleans up a missing candidate observation before persisting timeout failure', async (): Promise<void> => {
    const runtime: KubeRuntime & { delete: Mock; read: Mock } = pendingRuntimeStub(false);
    runtime.read.mockResolvedValue(null);

    await reconcileAt('2026-07-12T12:10:00.000Z', runtime, pendingTargetWithReadinessTimeout(10_000));

    const deleted: KubeManifest[] = runtime.delete.mock.calls[0]?.[0] as KubeManifest[];
    expect(deleted.map((object: KubeManifest): string => object.kind)).toEqual(['Secret', 'Deployment', 'Service']);
    expect(runtime.delete.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.observeDeploymentReconcile.mock.invocationCallOrder[0]!,
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
      applicationPod('dep_candidate', '2026-07-12T12:10:00.001Z'),
    ]);

    await reconcileAt('2026-07-12T12:10:00.001Z', runtime, pendingTargetWithReadinessTimeout(10_000));

    expect(mocks.observeDeploymentReconcile).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'failed', revision: 0 }),
    );
  });

  it('retains the initial Running timestamp across two container restarts', async (): Promise<void> => {
    const runtime: KubeRuntime & { observe: Mock } = pendingRuntimeStub(false);
    runtime.observe
      .mockResolvedValueOnce(kubeObservation([applicationPod('dep_candidate', '2026-07-12T12:00:00.000Z')]))
      .mockResolvedValueOnce(
        kubeObservation([applicationPod('dep_candidate', '2026-07-12T12:00:04.000Z', '2026-07-12T12:00:00.000Z')]),
      )
      .mockResolvedValueOnce(
        kubeObservation([applicationPod('dep_candidate', '2026-07-12T12:00:08.000Z', '2026-07-12T12:00:04.000Z')]),
      );
    const pendingTarget: DeploymentReconcileTarget = pendingTargetWithReadinessTimeout(10_000);

    await reconcileAt('2026-07-12T12:00:00.000Z', runtime, pendingTarget);
    await reconcileAt('2026-07-12T12:00:04.000Z', runtime, pendingTarget);
    expect(mocks.observeDeploymentReconcile).not.toHaveBeenCalled();

    await reconcileAt('2026-07-12T12:00:10.000Z', runtime, pendingTarget);

    expect(mocks.observeDeploymentReconcile).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'failed', revision: 0 }),
    );
  });

  it('retains the initial Running timestamp when a terminal observation is rejected as stale', async (): Promise<void> => {
    const runtime: KubeRuntime & { observe: Mock } = pendingRuntimeStub(false);
    runtime.observe
      .mockResolvedValueOnce(kubeObservation([applicationPod('dep_candidate', '2026-07-12T12:00:00.000Z')]))
      .mockResolvedValueOnce(
        kubeObservation([applicationPod('dep_candidate', '2026-07-12T12:00:08.000Z', '2026-07-12T12:00:04.000Z')]),
      )
      .mockResolvedValueOnce(
        kubeObservation([applicationPod('dep_candidate', '2026-07-12T12:00:08.000Z', '2026-07-12T12:00:04.000Z')]),
      );
    mocks.observeDeploymentReconcile.mockResolvedValue({ applied: false, cleanupArtifacts: [] });
    const pendingTarget: DeploymentReconcileTarget = pendingTargetWithReadinessTimeout(10_000);

    await reconcileAt('2026-07-12T12:00:00.000Z', runtime, pendingTarget);
    await reconcileAt('2026-07-12T12:00:10.000Z', runtime, pendingTarget);
    await reconcileAt('2026-07-12T12:00:10.001Z', runtime, pendingTarget);

    expect(mocks.observeDeploymentReconcile).toHaveBeenCalledTimes(2);
    expect(mocks.observeDeploymentReconcile).toHaveBeenLastCalledWith(
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

    await reconcileAt('2026-07-12T12:00:00.000Z', runtime, pendingTarget);

    expect(mocks.observeDeploymentReconcile).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'ready', revision: 0 }),
    );
  });

  it('rejects ready pending Deployments that do not match the UID and generation returned by apply', async (): Promise<void> => {
    const namespace: string = kubeNamespaceName('prj_1');
    const name: string = kubeApplicationIdentityName('env_1', 'svc_1');
    const applied: KubeManifest = readyDeployment(namespace, name, 'applied-uid', 2);
    const runtime: ApplyReadRuntime = {
      apply: vi.fn(async (): Promise<KubeManifest[]> => await Promise.resolve([applied])),
      read: vi.fn(
        async (): Promise<KubeManifest> => await Promise.resolve(readyDeployment(namespace, name, 'foreign-uid', 2)),
      ),
    } as never;
    const pendingTarget: DeploymentReconcileTarget = { ...target(projection(null)), state: 'pending' };

    await reconcileAt('2026-07-12T12:00:00.000Z', runtime, pendingTarget);

    expect(mocks.observeDeploymentReconcile).not.toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'ready' }),
    );
  });

  it('rejects ready pending Deployments from a generation newer than the current apply', async (): Promise<void> => {
    const namespace: string = kubeNamespaceName('prj_1');
    const name: string = kubeApplicationIdentityName('env_1', 'svc_1');
    const applied: KubeManifest = readyDeployment(namespace, name, 'applied-uid', 2);
    const runtime: ApplyReadRuntime = {
      apply: vi.fn(async (): Promise<KubeManifest[]> => await Promise.resolve([applied])),
      read: vi.fn(
        async (): Promise<KubeManifest> => await Promise.resolve(readyDeployment(namespace, name, 'applied-uid', 3)),
      ),
    } as never;
    const pendingTarget: DeploymentReconcileTarget = { ...target(projection(null)), state: 'pending' };

    await reconcileAt('2026-07-12T12:00:00.000Z', runtime, pendingTarget);

    expect(mocks.observeDeploymentReconcile).not.toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ observation: 'ready' }),
    );
  });

  it('deletes the projected application before acknowledging a Kubernetes stop', async (): Promise<void> => {
    const runtime: DeleteRuntime = {
      ...runtimeStub(),
      delete: vi.fn(async (): Promise<void> => await Promise.resolve()),
    } as never;
    const stoppingTarget: DeploymentReconcileTarget = {
      ...target(projection(null)),
      networkPolicy: { applicationPorts: [], resourcePorts: [5432] },
      state: 'stopping',
    };

    await reconcileDeploymentTarget(requester(), runtime, stoppingTarget);

    const deleted: KubeManifest[] = runtime.delete.mock.calls[0]?.[0] as KubeManifest[];
    expect(deleted.map((manifest: KubeManifest): string => manifest.kind)).toEqual(['Secret', 'Deployment', 'Service']);
    expect(mocks.applyNetworkPolicy).toHaveBeenCalledWith(expect.anything(), 'prj_1', {
      applicationPorts: [],
      resourcePorts: [5432],
    });
    expect(mocks.applyNetworkPolicy.mock.invocationCallOrder[0]).toBeGreaterThan(
      runtime.delete.mock.invocationCallOrder[0]!,
    );
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
    resourceEndpoints: [],
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

function kubernetesForbiddenError(message: string): Error {
  return Object.assign(new Error(message), { body: JSON.stringify({ message, reason: 'Forbidden' }), code: 403 });
}

function persistedObservation(): WorkerObserveDeploymentReconcileRequest {
  const observation: WorkerObserveDeploymentReconcileRequest | undefined =
    mocks.observeDeploymentReconcile.mock.calls.at(-1)?.[1] as WorkerObserveDeploymentReconcileRequest | undefined;
  if (observation === undefined) {
    throw new Error('Expected a persisted deployment observation.');
  }
  return observation;
}

function activeRuntimeStub(
  ready: boolean = true,
  progressDeadlineExceeded: boolean = false,
): KubeRuntime & { apply: Mock; delete: Mock; observe: Mock; read: Mock } {
  const namespace: string = kubeNamespaceName('prj_1');
  const name: string = kubeApplicationIdentityName('env_1', 'svc_1');
  return {
    apply: vi.fn(
      async (): Promise<KubeManifest[]> => await Promise.resolve([readyDeployment(namespace, name, 'applied-uid', 1)]),
    ),
    delete: vi.fn(async (): Promise<void> => await Promise.resolve()),
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
): KubeRuntime & { apply: Mock; delete: Mock; observe: Mock; read: Mock } {
  const namespace: string = kubeNamespaceName('prj_1');
  const name: string = kubeApplicationIdentityName('env_1', 'svc_1');
  const applied: KubeManifest = readyDeployment(namespace, name);
  return {
    apply: vi.fn(async (): Promise<KubeManifest[]> => await Promise.resolve([applied])),
    delete: vi.fn(async (): Promise<void> => await Promise.resolve()),
    observe: vi.fn(async (): Promise<KubeObservation> => await Promise.resolve(kubeObservation(pods))),
    read: vi.fn(
      async (): Promise<KubeManifest> =>
        await Promise.resolve(
          publishAfterSubscribe ? readyDeployment(namespace, name) : progressingDeployment(namespace, name),
        ),
    ),
  } as never;
}

function recoveryRuntimeStub(): RecoveryRuntime {
  const namespace: string = kubeNamespaceName('prj_1');
  const name: string = kubeApplicationIdentityName('env_1', 'svc_1');
  let observedDeployment: KubeManifest = progressingDeployment(namespace, name, true);
  let observationCount: number = 0;
  return {
    apply: vi.fn(async (bundle: ApplyBundle): Promise<KubeManifest[]> => {
      const deployment: KubeDeploymentManifest | undefined = bundle.objects.find(
        (object: KubeManifest): object is KubeDeploymentManifest => object.kind === 'Deployment',
      );
      if (deployment !== undefined) {
        observedDeployment = {
          ...deployment,
          metadata: { ...deployment.metadata, generation: 1, uid: 'applied-uid' },
          status: {
            availableReplicas: 0,
            conditions: [{ reason: 'ProgressDeadlineExceeded', status: 'False', type: 'Progressing' }],
            observedGeneration: 1,
          },
        };
      }
      return await Promise.resolve([observedDeployment]);
    }),
    delete: vi.fn(async (): Promise<void> => await Promise.resolve()),
    observe: vi.fn(async (): Promise<KubeObservation> => {
      const startedAt: string = observationCount === 0 ? '2026-07-12T11:00:00.000Z' : '2026-07-12T12:00:20.000Z';
      observationCount += 1;
      return await Promise.resolve(kubeObservation([applicationPod('dep_candidate', startedAt)]));
    }),
    read: vi.fn(async (): Promise<KubeManifest> => await Promise.resolve(observedDeployment)),
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

async function reconcileAt(
  now: string,
  runtime: KubeRuntime,
  pendingTarget: DeploymentReconcileTarget,
  configuredInfrastructureTimeoutMs: number = infrastructureTimeoutMs,
): Promise<void> {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(now);
    await reconcileDeploymentTarget(requester(), runtime, pendingTarget, undefined, configuredInfrastructureTimeoutMs);
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
  return projectApplicationManifests(
    {
      ...projection(null),
      deploymentId,
      env: { PORT: '3000' },
    },
    infrastructureTimeoutMs,
  ).find((manifest: KubeManifest): manifest is KubeDeploymentManifest => manifest.kind === 'Deployment')!;
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

function quotaFailedDeployment(
  namespace: string,
  name: string,
  message: string = 'pods "checkout" is forbidden: exceeded quota: project-quota, requested: requests.memory=256Mi, used: requests.memory=2Gi, limited: requests.memory=2Gi',
): KubeManifest {
  const deployment: KubeManifest = progressingDeployment(namespace, name);
  return {
    ...deployment,
    status: {
      conditions: [
        {
          message,
          reason: 'FailedCreate',
          status: 'True',
          type: 'ReplicaFailure',
        },
      ],
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

/** The reachability gate on the Deployment this reconcile applied, if it projected one. */
function appliedGate(runtime: ApplyReadRuntime): AppliedGateContainer | undefined {
  const bundle: ApplyBundle = runtime.apply.mock.calls.at(-1)?.[0] as ApplyBundle;
  const deployment: KubeDeploymentManifest | undefined = bundle.objects.find(
    (object: KubeManifest): object is KubeDeploymentManifest => object.kind === 'Deployment',
  );
  return deployment?.spec?.template.spec.initContainers?.[0];
}
