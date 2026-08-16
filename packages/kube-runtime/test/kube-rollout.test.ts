import { describe, expect, it } from 'vitest';
import {
  calculateKubeRolloutStatus,
  kubeDeploymentAvailable,
  readKubeApplicationRunningStartedAt,
  readKubeContainerRunningStartedAt,
  readKubeRolloutObservation,
  type KubeDeploymentManifest,
  type KubeObservedManifest,
  type KubeRolloutObservation,
} from '../src';
import { kubeApplicationName } from '../src/kube-naming';

interface ResourceDeploymentTestStatus {
  availableReplicas: number;
  desiredReplicas?: number;
  observedGeneration?: number;
  replicas?: number;
  updatedReplicas?: number;
}

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

  it('preserves the Kubernetes Deployment condition message', (): void => {
    const deployment: KubeDeploymentManifest = {
      ...(resourceDeployment({ availableReplicas: 0 }) as KubeDeploymentManifest),
      metadata: { generation: 4, name: 'resource-billing', namespace: 'cpt-billing', uid: 'deployment-uid' },
    };
    const observed: KubeObservedManifest = {
      ...deployment,
      status: {
        conditions: [
          {
            message: 'pods is forbidden: exceeded quota: project-quota',
            reason: 'FailedCreate',
            status: 'True',
            type: 'ReplicaFailure',
          },
        ],
        observedGeneration: 4,
      },
    };

    expect(readKubeRolloutObservation(observed, deployment, now)?.conditions).toEqual([
      {
        message: 'pods is forbidden: exceeded quota: project-quota',
        reason: 'FailedCreate',
        status: 'True',
        type: 'ReplicaFailure',
      },
    ]);
  });

  it('treats a resource Deployment as available only while this generation serves a ready replica', (): void => {
    expect(kubeDeploymentAvailable(resourceDeployment({ availableReplicas: 1 }))).toBe(true);
    expect(kubeDeploymentAvailable(resourceDeployment({ availableReplicas: 0 }))).toBe(false);
    expect(kubeDeploymentAvailable(resourceDeployment({ availableReplicas: 1, desiredReplicas: 0 }))).toBe(false);
    expect(kubeDeploymentAvailable(resourceDeployment({ availableReplicas: 1, observedGeneration: 3 }))).toBe(false);
    expect(kubeDeploymentAvailable({ ...resourceDeployment({ availableReplicas: 1 }), metadata: {}, status: {} })).toBe(
      false,
    );
    expect(kubeDeploymentAvailable(null)).toBe(false);
  });

  it('refuses a Recreate rollout whose replica still belongs to the previous generation', (): void => {
    expect(kubeDeploymentAvailable(resourceDeployment({ availableReplicas: 1, updatedReplicas: 0 }))).toBe(false);
    expect(kubeDeploymentAvailable(resourceDeployment({ availableReplicas: 1, replicas: 2 }))).toBe(false);
  });

  it('reads the earliest Running evidence only from the candidate application container', (): void => {
    const observed: KubeObservedManifest[] = [
      applicationPod('dep_old', '2026-07-11T12:00:01.000Z'),
      applicationPod('dep_candidate', '2026-07-11T12:00:13.000Z'),
      sidecarPod('dep_candidate', '2026-07-11T12:00:02.000Z'),
    ];

    expect(readKubeApplicationRunningStartedAt(observed, 'dep_candidate')).toEqual(
      new Date('2026-07-11T12:00:13.000Z'),
    );
  });

  it('keeps prior Running evidence when the candidate application container restarts', (): void => {
    const pod: KubeObservedManifest = applicationPod(
      'dep_candidate',
      '2026-07-11T12:00:18.000Z',
      '2026-07-11T12:00:08.000Z',
    );

    expect(readKubeApplicationRunningStartedAt([pod], 'dep_candidate')).toEqual(new Date('2026-07-11T12:00:08.000Z'));
  });

  it('uses only the current Running start for a resource container that restarted', (): void => {
    const pod: KubeObservedManifest = applicationPod(
      'dep_candidate',
      '2026-07-11T12:00:18.000Z',
      '2026-07-11T12:00:08.000Z',
    );

    expect(
      readKubeContainerRunningStartedAt(
        [pod],
        { 'compartment.dev/deployment-id': 'dep_candidate' },
        kubeApplicationName('dep_candidate'),
      ),
    ).toEqual(new Date('2026-07-11T12:00:18.000Z'));
  });
});

function resourceDeployment(status: ResourceDeploymentTestStatus): KubeObservedManifest {
  const desiredReplicas: number = status.desiredReplicas ?? 1;
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { generation: 4, name: 'resource-billing', namespace: 'cpt-billing' },
    spec: {
      progressDeadlineSeconds: 90,
      replicas: desiredReplicas,
      selector: { matchLabels: {} },
      strategy: { type: 'Recreate' },
      template: { metadata: { labels: {} }, spec: { automountServiceAccountToken: false, containers: [] } },
    },
    status: {
      availableReplicas: status.availableReplicas,
      observedGeneration: status.observedGeneration ?? 4,
      replicas: status.replicas ?? desiredReplicas,
      updatedReplicas: status.updatedReplicas ?? desiredReplicas,
    },
  };
}

function applicationPod(deploymentId: string, startedAt: string, previousStartedAt?: string): KubeObservedManifest {
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { labels: { 'compartment.dev/deployment-id': deploymentId } },
    status: {
      containerStatuses: [
        {
          ...(previousStartedAt === undefined ? {} : { lastState: { terminated: { startedAt: previousStartedAt } } }),
          name: kubeApplicationName(deploymentId),
          state: { running: { startedAt } },
        },
      ],
    },
  };
}

function sidecarPod(deploymentId: string, startedAt: string): KubeObservedManifest {
  return {
    ...applicationPod(deploymentId, startedAt),
    status: { containerStatuses: [{ name: 'sidecar', state: { running: { startedAt } } }] },
  };
}
