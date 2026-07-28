import type { CustomDomainRow } from '../src/queries/custom-domains.query.types';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { persistCustomDomainVerificationResult } from '../src/services/custom-domain-edge-state.service';

const updateCheck: Mock = vi.hoisted((): Mock => vi.fn());

vi.mock('../src/queries/custom-domains.query', (): object => ({ updateCustomDomainCheck: updateCheck }));

describe('custom domain verification lifecycle', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
  });

  it('moves failed ownership or routing verification to failed, never active', async (): Promise<void> => {
    await persistCustomDomainVerificationResult(domainRow(), 'app.customer.example.com', {
      failureMessage: 'Ownership TXT record is not valid yet.',
      ownershipStatus: 'invalid',
      routingStatus: 'valid',
    });

    expect(updateCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        reconcileState: 'failed',
        ownershipStatus: 'invalid',
        routingStatus: 'valid',
      }),
    );
  });

  it('moves successful verification to reconciling with a new desired generation', async (): Promise<void> => {
    await persistCustomDomainVerificationResult(domainRow(), 'app.customer.example.com', {
      failureMessage: null,
      ownershipStatus: 'valid',
      routingStatus: 'valid',
    });

    expect(updateCheck).toHaveBeenCalledWith(
      expect.objectContaining({ desiredGeneration: 2, reconcileState: 'reconciling' }),
    );
  });
});

function domainRow(): CustomDomainRow {
  return {
    createdAt: new Date(),
    desiredGeneration: 1,
    edgeRoutingEnabled: false,
    environmentId: 'env_1',
    environmentName: 'production',
    failureMessage: null,
    host: 'app.customer.example.com',
    id: 'cdom_1',
    lastCheckedAt: null,
    observedCertificatePresent: false,
    observedCertificateReady: false,
    observedGeneration: 0,
    observedIngressPresent: false,
    organizationId: 'org_1',
    ownershipStatus: 'pending',
    projectId: 'prj_1',
    projectName: 'billing',
    reconcileLeaseExpiresAt: null,
    reconcileLeaseId: null,
    reconcileState: 'pending',
    routingStatus: 'pending',
    serviceId: 'svc_1',
    serviceName: 'web',
    updatedAt: new Date(),
    verificationTokenHash: 'hash',
    verifiedAt: null,
  };
}
