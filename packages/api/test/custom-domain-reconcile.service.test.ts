import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { completeCustomDomainReconcile } from '../src/services/custom-domain-reconcile.service';

const activate: Mock = vi.hoisted((): Mock => vi.fn());
const enableEdge: Mock = vi.hoisted((): Mock => vi.fn());
const readLease: Mock = vi.hoisted((): Mock => vi.fn());
const settle: Mock = vi.hoisted((): Mock => vi.fn());
const syncEdge: Mock = vi.hoisted((): Mock => vi.fn());

vi.mock('../src/queries/custom-domain-reconcile.query', (): object => ({
  activateCustomDomainReconcileRow: activate,
  claimCustomDomainReconcileRow: vi.fn(),
  enableCustomDomainEdgeRouting: enableEdge,
  failCustomDomainReconcileRow: vi.fn(),
  observeCustomDomainReconcileRow: vi.fn(),
  readCustomDomainReconcileLease: readLease,
  settleDeletedCustomDomain: settle,
}));
vi.mock('../src/services/app-access-edge.service', (): object => ({
  synchronizeEdgeAppAccessState: syncEdge,
}));

interface ReconcileLeaseOverrides {
  observedCertificateReady?: boolean;
  observedIngressPresent?: boolean;
  operation?: 'delete' | 'reconcile';
}

describe('custom domain reconcile completion', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    activate.mockResolvedValue(true);
    enableEdge.mockResolvedValue(true);
    settle.mockResolvedValue(true);
  });

  it('does not activate Edge before Certificate Ready=True', async (): Promise<void> => {
    readLease.mockResolvedValue(reconcileLease({ observedCertificateReady: false }));

    await expect(completeCustomDomainReconcile(completion())).resolves.toEqual({ applied: false });

    expect(activate).not.toHaveBeenCalled();
    expect(syncEdge).not.toHaveBeenCalled();
  });

  it('activates Edge only after the observed generation has both objects and Certificate Ready=True', async (): Promise<void> => {
    readLease.mockResolvedValue(reconcileLease());

    await expect(completeCustomDomainReconcile(completion())).resolves.toEqual({ applied: true });

    expect(activate).toHaveBeenCalledWith('lease_1', 2);
    expect(enableEdge).toHaveBeenCalledWith('lease_1', 2);
    expect(syncEdge).toHaveBeenCalledOnce();
  });

  it('does not remove durable state while either exact Kubernetes object remains', async (): Promise<void> => {
    readLease.mockResolvedValue(reconcileLease({ observedIngressPresent: true, operation: 'delete' }));

    await expect(completeCustomDomainReconcile(completion())).resolves.toEqual({ applied: false });

    expect(settle).not.toHaveBeenCalled();
  });

  it('keeps activation retryable when Edge synchronization fails before finalization', async (): Promise<void> => {
    readLease.mockResolvedValue(reconcileLease());
    syncEdge.mockRejectedValueOnce(new Error('Edge unavailable.'));

    await expect(completeCustomDomainReconcile(completion())).rejects.toThrow('Edge unavailable.');

    expect(enableEdge).toHaveBeenCalledWith('lease_1', 2);
    expect(activate).not.toHaveBeenCalled();
  });
});

function completion(): { leaseId: string; observedGeneration: number } {
  return { leaseId: 'lease_1', observedGeneration: 2 };
}

function reconcileLease(overrides: ReconcileLeaseOverrides = {}): object {
  return {
    desiredGeneration: 2,
    domainId: 'cdom_1',
    host: 'app.customer.example.com',
    observedCertificatePresent: true,
    observedCertificateReady: true,
    observedGeneration: 2,
    observedIngressPresent: true,
    operation: 'reconcile',
    ...overrides,
  };
}
