import { KubeRuntime } from '@compartment/kube-runtime';
import { completeOrganizationQuotaReconcile, type CompartmentRequester } from '@compartment/sdk';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { executeOrganizationQuotaReconcile } from '../src/services/worker-organization-quota-reconcile.service';

const complete: Mock = vi.hoisted((): Mock => vi.fn());

vi.mock('@compartment/sdk', (): object => ({ completeOrganizationQuotaReconcile: complete }));

interface RuntimeMethods {
  apply: Mock;
  read: Mock;
}

describe('organization quota reconciliation', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    complete.mockResolvedValue({ applied: true });
  });

  it('completes only after every quota reports infrastructure readiness', async (): Promise<void> => {
    const methods: RuntimeMethods = {
      apply: vi.fn().mockResolvedValue([]),
      read: vi.fn().mockResolvedValue({ status: { conditions: [{ status: 'True', type: 'Ready' }] } }),
    };
    await executeOrganizationQuotaReconcile({} as CompartmentRequester, runtimeFixture(methods), {
      leaseId: 'oql_1',
      organizationId: 'org_1',
    });
    expect(methods.apply).toHaveBeenCalledOnce();
    expect(methods.read).toHaveBeenCalledTimes(5);
    expect(completeOrganizationQuotaReconcile).toHaveBeenCalledWith(expect.anything(), {
      leaseId: 'oql_1',
      organizationId: 'org_1',
      status: 'succeeded',
    });
  });

  it('waits for the quota controller to publish readiness after apply', async (): Promise<void> => {
    vi.useFakeTimers();
    const methods: RuntimeMethods = {
      apply: vi.fn().mockResolvedValue([]),
      read: vi
        .fn()
        .mockResolvedValueOnce({ status: { conditions: [] } })
        .mockResolvedValue({ status: { conditions: [{ status: 'True', type: 'Ready' }] } }),
    };
    const reconciliation: Promise<void> = executeOrganizationQuotaReconcile(
      {} as CompartmentRequester,
      runtimeFixture(methods),
      { leaseId: 'oql_1', organizationId: 'org_1' },
    );
    await vi.runAllTimersAsync();
    await reconciliation;
    vi.useRealTimers();
    expect(methods.read).toHaveBeenCalledTimes(6);
    expect(complete).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ status: 'succeeded' }));
  });

  it('fails infrastructure that reports a non-ready condition without reading usage', async (): Promise<void> => {
    const methods: RuntimeMethods = {
      apply: vi.fn().mockResolvedValue([]),
      read: vi.fn().mockResolvedValue({ status: { conditions: [{ status: 'False', type: 'Ready' }] } }),
    };
    await expect(
      executeOrganizationQuotaReconcile({} as CompartmentRequester, runtimeFixture(methods), {
        leaseId: 'oql_1',
        organizationId: 'org_1',
      }),
    ).rejects.toThrow('is not ready');
    expect(methods.apply).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ status: 'failed' }));
  });

  it('rejects a fenced success completion', async (): Promise<void> => {
    complete.mockResolvedValueOnce({ applied: false });
    const methods: RuntimeMethods = {
      apply: vi.fn().mockResolvedValue([]),
      read: vi.fn().mockResolvedValue({ status: { conditions: [{ status: 'True', type: 'Ready' }] } }),
    };
    await expect(
      executeOrganizationQuotaReconcile({} as CompartmentRequester, runtimeFixture(methods), {
        leaseId: 'oql_stale',
        organizationId: 'org_1',
      }),
    ).rejects.toThrow('lease is no longer current');
  });

  it('rejects a fenced failure completion', async (): Promise<void> => {
    complete.mockResolvedValueOnce({ applied: false });
    const methods: RuntimeMethods = {
      apply: vi.fn().mockRejectedValue(new Error('apply failed')),
      read: vi.fn(),
    };
    await expect(
      executeOrganizationQuotaReconcile({} as CompartmentRequester, runtimeFixture(methods), {
        leaseId: 'oql_stale',
        organizationId: 'org_1',
      }),
    ).rejects.toThrow('lease is no longer current');
  });
});

function runtimeFixture(methods: RuntimeMethods): KubeRuntime {
  return Object.assign(Object.create(KubeRuntime.prototype) as KubeRuntime, methods);
}
