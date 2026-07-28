import {
  workerClaimCustomDomainReconcileResponseSchema,
  workerObserveCustomDomainReconcileRequestSchema,
} from '../src';
import { describe, expect, it } from 'vitest';

describe('internal custom domain reconcile contract', (): void => {
  it('rejects a ready Certificate observation when the Certificate is absent', (): void => {
    expect(
      workerObserveCustomDomainReconcileRequestSchema.safeParse({
        certificatePresent: false,
        certificateReady: true,
        ingressPresent: true,
        leaseId: 'lease_1',
        observedGeneration: 1,
        releaseLease: false,
      }).success,
    ).toBe(false);
  });

  it('keeps claim identity and target atomic', (): void => {
    expect(workerClaimCustomDomainReconcileResponseSchema.safeParse({ leaseId: 'lease_1', target: null }).success).toBe(
      false,
    );
    expect(workerClaimCustomDomainReconcileResponseSchema.safeParse({ leaseId: null, target: null }).success).toBe(
      true,
    );
  });
});
