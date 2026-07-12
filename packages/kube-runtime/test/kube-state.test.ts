import { describe, expect, it } from 'vitest';
import { calculateKubeStateTransition, type KubeObservedDeployment } from '../src';

const readyDeployment: KubeObservedDeployment = {
  availableReplicas: 1,
  desiredFieldsDrifted: false,
  exists: true,
  generation: 4,
  observedGeneration: 4,
  requiredObjectsPresent: true,
};
const now: Date = new Date('2026-07-11T12:00:00.000Z');

describe('T9 kill matrix', (): void => {
  it('recovers after desired persistence and before apply', (): void => {
    expect(
      calculateKubeStateTransition(
        { desiredReplicas: 1, observedAt: null, state: 'desired' },
        missingDeployment(),
        now,
      ),
    ).toEqual({ action: 'apply', audit: null, nextState: 'pending', observedAt: null });
  });

  it('repeats SSA after apply and before pending persistence', (): void => {
    expect(
      calculateKubeStateTransition({ desiredReplicas: 1, observedAt: null, state: 'desired' }, readyDeployment, now),
    ).toEqual({ action: 'apply', audit: null, nextState: 'pending', observedAt: null });
  });

  it('waits from pending until Ready is observed', (): void => {
    expect(
      calculateKubeStateTransition(
        { desiredReplicas: 1, observedAt: null, state: 'pending' },
        { ...readyDeployment, availableReplicas: 0, observedGeneration: 3 },
        now,
      ),
    ).toEqual({ action: 'none', audit: null, nextState: 'pending', observedAt: null });
  });

  it('replays a concurrent informer callback without losing drift audit', (): void => {
    expect(
      calculateKubeStateTransition(
        { desiredReplicas: 1, observedAt: new Date('2026-07-11T11:00:00.000Z'), state: 'active' },
        { ...readyDeployment, desiredFieldsDrifted: true },
        now,
      ),
    ).toEqual({
      action: 'apply',
      audit: { kind: 'drifted', message: 'Controller-owned Kubernetes fields drifted.' },
      nextState: 'pending',
      observedAt: new Date('2026-07-11T11:00:00.000Z'),
    });
  });

  it('marks active only from an informer-observed current generation', (): void => {
    expect(
      calculateKubeStateTransition({ desiredReplicas: 1, observedAt: null, state: 'pending' }, readyDeployment, now),
    ).toEqual({ action: 'none', audit: null, nextState: 'active', observedAt: now });
  });

  it('reapplies a missing pending object without recording active drift', (): void => {
    expect(
      calculateKubeStateTransition(
        { desiredReplicas: 1, observedAt: null, state: 'pending' },
        missingDeployment(),
        now,
      ),
    ).toEqual({ action: 'apply', audit: null, nextState: 'pending', observedAt: null });
  });
});

function missingDeployment(): KubeObservedDeployment {
  return {
    availableReplicas: 0,
    desiredFieldsDrifted: false,
    exists: false,
    generation: null,
    observedGeneration: null,
    requiredObjectsPresent: false,
  };
}
