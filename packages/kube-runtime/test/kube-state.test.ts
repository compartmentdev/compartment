import { describe, expect, it } from 'vitest';
import {
  calculateKubeRolloutStatus,
  calculateKubeStateTransition,
  type KubeObservedDeployment,
  type KubeRolloutObservation,
} from '../src';

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

describe('rollout observation decisions', (): void => {
  const rollout: KubeRolloutObservation = {
    availableReplicas: 0,
    conditions: [],
    deadlineAt: new Date('2026-07-11T12:00:45.000Z'),
    desiredReplicas: 1,
    generation: 4,
    observedGeneration: 3,
    replicas: 1,
    updatedReplicas: 1,
  };

  it('reports ProgressDeadlineExceeded before considering a rollout Ready', (): void => {
    expect(
      calculateKubeRolloutStatus(
        {
          ...rollout,
          availableReplicas: 1,
          conditions: [{ reason: 'ProgressDeadlineExceeded', status: 'False', type: 'Progressing' }],
          observedGeneration: 4,
        },
        now,
      ),
    ).toBe('progress-deadline-exceeded');
  });

  it('times out a rollout without a terminal Kubernetes condition', (): void => {
    expect(calculateKubeRolloutStatus(rollout, rollout.deadlineAt)).toBe('timed-out');
  });

  it('requires the current generation and desired replicas for Ready', (): void => {
    expect(calculateKubeRolloutStatus({ ...rollout, availableReplicas: 1, observedGeneration: 4 }, now)).toBe('ready');
    expect(calculateKubeRolloutStatus(rollout, now)).toBe('progressing');
  });

  it('waits for old replicas to leave the stable Service selector', (): void => {
    expect(
      calculateKubeRolloutStatus({ ...rollout, availableReplicas: 2, observedGeneration: 4, replicas: 2 }, now),
    ).toBe('progressing');
    expect(
      calculateKubeRolloutStatus({ ...rollout, availableReplicas: 1, observedGeneration: 4, updatedReplicas: 0 }, now),
    ).toBe('progressing');
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
