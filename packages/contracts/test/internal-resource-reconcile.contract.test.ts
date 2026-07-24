import { describe, expect, it } from 'vitest';
import { resourceReconcileLifecycleTimeoutMs } from '../src/contracts/internal-resource-reconcile.contract';
import {
  workerAcknowledgeResourceReconcileRequestSchema,
  workerClaimResourceReconcileResponseSchema,
  type ResourceReconcileIntent,
} from '../src';

const intent: ResourceReconcileIntent = {
  command: ['postgres', '-c', 'shared_buffers=256MB'],
  deleteData: false,
  environmentId: 'env_1',
  env: {},
  image: 'postgres:17',
  namespaceId: 'project_1',
  operation: 'reconcile',
  ports: [5432, 9187],
  readiness: { port: 5432, timeoutMs: 30_000, type: 'tcp' },
  replicas: 1,
  resourceId: 'resource_1',
  secretId: 'secret_1',
  volumes: [{ mountPath: '/var/lib/postgresql/data', size: '1Gi', volumeHandle: 'data' }],
};

interface TestResourceReconcileClaim {
  expectedClaims: { claimName: string; uid: string }[];
  intent: ResourceReconcileIntent;
  leaseId: string;
  networkPolicy: { applicationPorts: number[]; resourcePorts: number[] };
  operationId: string;
  previousManifestJson: null;
  type: 'reconcile';
}

describe('internal resource reconcile contracts', (): void => {
  it('owns the shared worker lifecycle observation budget at the internal boundary', (): void => {
    expect(resourceReconcileLifecycleTimeoutMs).toBe(120_000);
  });

  it('accepts only explicit running or stopped replica intent', (): void => {
    expect(workerClaimResourceReconcileResponseSchema.safeParse(claim({ ...intent, replicas: 0 })).success).toBe(true);
    expect(
      workerClaimResourceReconcileResponseSchema.safeParse({
        ...claim(intent),
        intent: { ...intent, replicas: 2 },
      }).success,
    ).toBe(false);
  });

  it('preserves the complete resource process and network intent', (): void => {
    expect(workerClaimResourceReconcileResponseSchema.safeParse(claim(intent))).toMatchObject({
      success: true,
    });
    expect(
      workerClaimResourceReconcileResponseSchema.safeParse(
        claim({ ...intent, command: [], ports: [], readiness: null }),
      ).success,
    ).toBe(true);
  });

  it('rejects an ordinary claim without operation identity', (): void => {
    expect(
      workerClaimResourceReconcileResponseSchema.safeParse({
        expectedClaims: [{ claimName: 'claim', uid: 'uid' }],
        intent,
        leaseId: 'lease_1',
        previousManifestJson: null,
        type: 'reconcile',
      }).success,
    ).toBe(false);
  });

  it('accepts explicit bootstrap completion with externally captured claim UIDs', (): void => {
    expect(
      workerAcknowledgeResourceReconcileRequestSchema.safeParse({
        expectedClaims: [{ claimName: 'claim', uid: 'uid' }],
        leaseId: 'lease_1',
        operationId: 'resource_operation_1',
        status: 'succeeded',
      }).success,
    ).toBe(true);
  });
});

function claim(candidate: ResourceReconcileIntent): TestResourceReconcileClaim {
  return {
    expectedClaims: [{ claimName: 'claim', uid: 'uid' }],
    intent: candidate,
    leaseId: 'lease_1',
    networkPolicy: { applicationPorts: [8080], resourcePorts: candidate.ports },
    operationId: 'resource_operation_1',
    previousManifestJson: null,
    type: 'reconcile',
  };
}
