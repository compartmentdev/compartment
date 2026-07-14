import type { DeploymentReconcilePair } from '../src/queries/deployment-reconcile.query.types';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { claimDeploymentReconcileTarget } from '../src/services/deployment-reconcile.service';

interface ReconcileMocks {
  buildPlan: Mock;
  findPair: Mock;
}

const mocks: ReconcileMocks = vi.hoisted(
  (): ReconcileMocks => ({
    buildPlan: vi.fn(),
    findPair: vi.fn(),
  }),
);

vi.mock('../src/queries/deployment-reconcile.query', (): object => ({
  findNextDeploymentReconcilePair: mocks.findPair,
  persistDeploymentReconcileObservation: vi.fn(),
  prepareDeploymentReconcileReference: vi.fn(),
}));

vi.mock('../src/services/deployment-runtime-plan.service', (): object => ({
  buildDeploymentRuntimePlan: mocks.buildPlan,
}));

describe('deployment reconcile projection', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
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
      resolvedRunJson: '{"command":"npm run start:override","restart":{"policy":"unless-stopped"}}',
      revision: 1,
      serviceId: 'svc-1',
      serviceName: 'web',
      state: 'desired',
      transitionedAt: new Date('2026-07-13T12:00:00.000Z'),
    },
  };
}
