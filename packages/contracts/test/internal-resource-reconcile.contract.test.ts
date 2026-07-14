import { describe, expect, it } from 'vitest';
import {
  workerAcknowledgeResourceReconcileRequestSchema,
  workerClaimResourceReconcileResponseSchema,
  type ResourceReconcileIntent,
} from '../src';

const intent: ResourceReconcileIntent = {
  containerPort: 5432,
  deleteData: false,
  environmentId: 'env_1',
  env: {},
  image: 'postgres:17',
  namespaceId: 'project_1',
  operation: 'reconcile',
  replicas: 1,
  resourceId: 'resource_1',
  secretId: 'secret_1',
  volumes: [{ mountPath: '/var/lib/postgresql/data', size: '1Gi', volumeHandle: 'data' }],
};

interface TestResourceReconcileClaim {
  expectedClaims: { claimName: string; uid: string }[];
  intent: ResourceReconcileIntent;
  leaseId: string;
  operationId: string;
  previousManifestJson: null;
  type: 'reconcile';
}

describe('internal resource reconcile contracts', (): void => {
  it('accepts only explicit running or stopped replica intent', (): void => {
    expect(workerClaimResourceReconcileResponseSchema.safeParse(claim({ ...intent, replicas: 0 })).success).toBe(true);
    expect(
      workerClaimResourceReconcileResponseSchema.safeParse({
        ...claim(intent),
        intent: { ...intent, replicas: 2 },
      }).success,
    ).toBe(false);
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
    operationId: 'resource_operation_1',
    previousManifestJson: null,
    type: 'reconcile',
  };
}
