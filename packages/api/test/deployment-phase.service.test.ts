import { describe, expect, it } from 'vitest';
import { resolveObservedDeploymentPhase } from '../src/services/deployment-phase.service.helpers';

describe('deployment phase service', (): void => {
  it('prefers Kubernetes readiness over a completed image build when rollout times out', (): void => {
    expect(
      resolveObservedDeploymentPhase({
        events: [
          { createdAt: new Date('2026-07-23T12:00:00.000Z'), status: 'succeeded', stepKey: 'building_image' },
          { createdAt: new Date('2026-07-23T12:01:00.000Z'), status: 'succeeded', stepKey: 'publishing_image' },
        ],
        kubeState: 'pending',
        operationType: 'deployment.create',
        status: 'failed',
        storedStage: 'building',
      }),
    ).toBe('awaiting_readiness');
  });

  it('reports kube apply after a successful build reaches a desired reference', (): void => {
    expect(
      resolveObservedDeploymentPhase({
        events: [{ createdAt: new Date('2026-07-23T12:00:00.000Z'), status: 'succeeded', stepKey: 'building_image' }],
        kubeState: 'desired',
        operationType: 'deployment.create',
        status: 'running',
        storedStage: 'building',
      }),
    ).toBe('kube_apply');
  });

  it('uses rollback-owned restoring and activating phases', (): void => {
    expect(
      resolveObservedDeploymentPhase({
        events: [],
        kubeState: 'desired',
        operationType: 'deployment.rollback',
        status: 'running',
        storedStage: 'building',
      }),
    ).toBe('restoring');
    expect(
      resolveObservedDeploymentPhase({
        events: [],
        kubeState: 'pending',
        operationType: 'deployment.rollback',
        status: 'running',
        storedStage: 'building',
      }),
    ).toBe('activating');
  });

  it('keeps the real failed step instead of treating the terminal event as active', (): void => {
    expect(
      resolveObservedDeploymentPhase({
        events: [
          { createdAt: new Date('2026-07-23T12:00:00.000Z'), status: 'running', stepKey: 'building_image' },
          { createdAt: new Date('2026-07-23T12:00:30.000Z'), status: 'failed', stepKey: 'building_image' },
          { createdAt: new Date('2026-07-23T12:00:31.000Z'), status: 'failed', stepKey: 'completed' },
        ],
        kubeState: null,
        operationType: 'deployment.create',
        status: 'failed',
        storedStage: 'building',
      }),
    ).toBe('building_image');
  });

  it('attributes a post-build worker failure to Kubernetes handoff', (): void => {
    expect(
      resolveObservedDeploymentPhase({
        events: [
          { createdAt: new Date('2026-07-23T12:00:00.000Z'), status: 'succeeded', stepKey: 'building_image' },
          { createdAt: new Date('2026-07-23T12:00:01.000Z'), status: 'failed', stepKey: 'completed' },
        ],
        kubeState: null,
        operationType: 'deployment.create',
        status: 'failed',
        storedStage: 'building',
      }),
    ).toBe('kube_apply');
  });
});
