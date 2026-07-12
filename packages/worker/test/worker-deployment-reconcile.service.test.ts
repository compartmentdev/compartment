import type { DeploymentReconcileProjection, DeploymentReconcileTarget } from '@compartment/contracts';
import type { ApplyBundle, KubeManifest, KubeRuntime } from '@compartment/kube-runtime';
import type { CompartmentRequester } from '@compartment/sdk';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { reconcileDeploymentTarget } from '../src/services/worker-deployment-reconcile.service';

interface ReconcileMocks {
  executeProductJob: Mock;
  observeDeploymentReconcile: Mock;
}

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
    namespaceId: 'prj_1',
    organizationId: 'org_1',
    organizationName: 'Acme',
    projectId: 'prj_1',
    projectName: 'checkout',
    releaseCommand,
    replicas: 1,
    secretId: 'dep_candidate',
    serviceId: 'svc_1',
    serviceName: 'web',
    terminationGracePeriodSeconds: 45,
  };
}

function runtimeStub(): KubeRuntime & { apply: Mock } {
  return { apply: vi.fn(async (): Promise<KubeManifest[]> => await Promise.resolve([])) } as never;
}

function requester(): CompartmentRequester {
  return async function unexpectedRequest<TResult>(): Promise<TResult> {
    await Promise.resolve();
    throw new Error('Unexpected direct request.');
  };
}
