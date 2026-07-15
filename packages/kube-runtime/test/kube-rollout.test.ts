import { describe, expect, it } from 'vitest';
import { calculateKubeRolloutStatus, type KubeRolloutObservation } from '../src';

const now: Date = new Date('2026-07-11T12:00:00.000Z');

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
