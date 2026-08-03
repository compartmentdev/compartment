import { describe, expect, it } from 'vitest';
import {
  kubernetesSystemRestartResponseSchema,
  kubernetesSystemStatusResponseSchema,
  kubernetesSystemUpdateResponseSchema,
  type KubernetesSystemStatusResponse,
} from '../src/contracts/kubernetes-system.contract';

const readyStatus: KubernetesSystemStatusResponse = {
  ready: true,
  releaseName: 'compartment',
  releaseStatus: 'deployed',
  workloads: [
    { desiredReplicas: 1, kind: 'Deployment', name: 'api', ready: true, readyReplicas: 1 },
    { desiredReplicas: 2, kind: 'DaemonSet', name: 'product-log-agent', ready: true, readyReplicas: 2 },
  ],
};

describe('Kubernetes system lifecycle contracts', (): void => {
  it('accepts explicit status, restart, and update payloads', (): void => {
    expect(kubernetesSystemStatusResponseSchema.parse(readyStatus)).toEqual(readyStatus);
    expect(kubernetesSystemRestartResponseSchema.parse({ restarted: true, status: readyStatus })).toMatchObject({
      restarted: true,
    });
    expect(
      kubernetesSystemUpdateResponseSchema.parse({ status: readyStatus, updated: true, version: 'sha-release' }),
    ).toMatchObject({ updated: true, version: 'sha-release' });
  });

  it('rejects incomplete readiness data', (): void => {
    expect(
      (): KubernetesSystemStatusResponse =>
        kubernetesSystemStatusResponseSchema.parse({
          ...readyStatus,
          workloads: [{ kind: 'Deployment', name: 'api' }],
        }),
    ).toThrow();
  });
});
