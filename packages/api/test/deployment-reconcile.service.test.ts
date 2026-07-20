import type { DeploymentReconcilePair } from '../src/queries/deployment-reconcile.query.types';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  claimDeploymentReconcileTarget,
  observeDeploymentReconcile,
} from '../src/services/deployment-reconcile.service';

interface ReconcileMocks {
  buildPlan: Mock;
  findFailedPrerequisite: Mock;
  findPair: Mock;
  persistObservation: Mock;
  planRetention: Mock;
  synchronizeEdge: Mock;
}

const mocks: ReconcileMocks = vi.hoisted(
  (): ReconcileMocks => ({
    buildPlan: vi.fn(),
    findFailedPrerequisite: vi.fn(),
    findPair: vi.fn(),
    persistObservation: vi.fn(),
    planRetention: vi.fn(),
    synchronizeEdge: vi.fn(),
  }),
);

vi.mock('../src/queries/deployment-reconcile.query', (): object => ({
  findNextDeploymentReconcilePair: mocks.findPair,
  persistDeploymentReconcileObservation: mocks.persistObservation,
  prepareDeploymentReconcileReference: vi.fn(),
}));

vi.mock('../src/queries/deployment-resource-readiness.query', (): object => ({
  findFailedDeploymentResourcePrerequisite: mocks.findFailedPrerequisite,
}));

vi.mock('../src/services/deployment-runtime-plan.service', (): object => ({
  buildDeploymentRuntimePlan: mocks.buildPlan,
}));

vi.mock('../src/services/deployment-retention.service', (): object => ({
  planRollbackRetentionCleanup: mocks.planRetention,
}));

vi.mock('../src/services/app-access-edge.service', (): object => ({
  synchronizeEdgeAppAccessState: mocks.synchronizeEdge,
}));

describe('deployment reconcile projection', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    mocks.findFailedPrerequisite.mockResolvedValue(null);
    mocks.persistObservation.mockResolvedValue(true);
    mocks.planRetention.mockResolvedValue([]);
    mocks.synchronizeEdge.mockResolvedValue(undefined);
  });

  it('returns rollback cleanup work from the Kubernetes-ready transition', async (): Promise<void> => {
    mocks.planRetention.mockResolvedValue([
      { artifactId: 'art-old', imageRef: `registry/app@sha256:${'a'.repeat(64)}` },
    ]);

    await expect(
      observeDeploymentReconcile({
        deploymentId: 'dep-1',
        observation: 'ready',
        observedAt: '2026-07-15T12:00:00.000Z',
        revision: 1,
      }),
    ).resolves.toEqual({
      applied: true,
      cleanupArtifacts: [{ artifactId: 'art-old', imageRef: `registry/app@sha256:${'a'.repeat(64)}` }],
    });
    expect(mocks.planRetention).toHaveBeenCalledWith('dep-1');
  });

  it('carries resolved descriptor runtime behavior to the worker projection', async (): Promise<void> => {
    mocks.findPair.mockResolvedValue(pair());
    mocks.buildPlan.mockResolvedValue({
      runtimeEnv: { PORT: '3000' },
      runtimeNetwork: { requiresResourceNetwork: false },
    });

    await expect(claimDeploymentReconcileTarget()).resolves.toMatchObject({
      candidate: {
        readiness: { path: '/healthz', timeoutMs: 60_000, type: 'http' },
        runCommand: 'npm run start:override',
      },
    });
  });
});

function pair(): DeploymentReconcilePair {
  return {
    active: null,
    candidate: {
      deploymentId: 'dep-1',
      environmentId: 'env-1',
      environmentName: 'production',
      image: 'registry/app@sha256:abc',
      organizationId: 'org-1',
      organizationName: 'Acme',
      projectId: 'prj-1',
      projectName: 'app',
      resolvedReadinessJson: '{"path":"/healthz","timeoutMs":60000,"type":"http"}',
      resolvedReleaseJson: 'null',
      resolvedRunJson: '{"command":"npm run start:override"}',
      revision: 1,
      serviceId: 'svc-1',
      serviceName: 'web',
      state: 'desired',
      transitionedAt: new Date('2026-07-13T12:00:00.000Z'),
    },
  };
}
