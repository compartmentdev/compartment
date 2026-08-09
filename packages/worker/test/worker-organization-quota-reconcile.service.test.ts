import { KubeRuntime, kubeNamespaceName, type KubeManifest } from '@compartment/kube-runtime';
import { completeOrganizationQuotaReconcile, type CompartmentRequester } from '@compartment/sdk';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { executeOrganizationQuotaReconcile } from '../src/services/worker-organization-quota-reconcile.service';

const complete: Mock = vi.hoisted((): Mock => vi.fn());

vi.mock('@compartment/sdk', (): object => ({ completeOrganizationQuotaReconcile: complete }));

interface RuntimeMethods {
  apply: Mock;
  mergePatchExisting: Mock;
  read: Mock;
}

function runtimeMethods(read: Mock): RuntimeMethods {
  return { apply: vi.fn().mockResolvedValue([]), mergePatchExisting: vi.fn().mockResolvedValue({}), read };
}

describe('organization quota reconciliation', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    complete.mockResolvedValue({ applied: true });
  });

  it('completes only after every quota reports infrastructure readiness', async (): Promise<void> => {
    const methods: RuntimeMethods = runtimeMethods(
      vi.fn().mockResolvedValue({ status: { conditions: [{ status: 'True', type: 'Ready' }] } }),
    );
    await executeOrganizationQuotaReconcile({} as CompartmentRequester, runtimeFixture(methods), {
      leaseId: 'oql_1',
      namespaceIds: [],
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
    const methods: RuntimeMethods = runtimeMethods(
      vi
        .fn()
        .mockResolvedValueOnce({ status: { conditions: [] } })
        .mockResolvedValue({ status: { conditions: [{ status: 'True', type: 'Ready' }] } }),
    );
    const reconciliation: Promise<void> = executeOrganizationQuotaReconcile(
      {} as CompartmentRequester,
      runtimeFixture(methods),
      { leaseId: 'oql_1', namespaceIds: [], organizationId: 'org_1' },
    );
    await vi.runAllTimersAsync();
    await reconciliation;
    vi.useRealTimers();
    expect(methods.read).toHaveBeenCalledTimes(6);
    expect(complete).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ status: 'succeeded' }));
  });

  it('labels every existing project namespace before completing reconciliation', async (): Promise<void> => {
    const methods: RuntimeMethods = runtimeMethods(
      vi.fn().mockImplementation(async (manifest: KubeManifest): Promise<object | null> => {
        await Promise.resolve();
        if (manifest.kind === 'GlobalCustomQuota') {
          return { status: { conditions: [{ status: 'True', type: 'Ready' }] } };
        }
        if (manifest.metadata?.name === kubeNamespaceName('prj-missing')) {
          return null;
        }
        return {
          metadata: {
            labels: {
              'app.kubernetes.io/managed-by': 'compartment',
              'compartment.dev/namespace-id': 'prj-existing',
              'compartment.dev/project-id': 'prj-existing',
            },
          },
        };
      }),
    );
    await executeOrganizationQuotaReconcile({} as CompartmentRequester, runtimeFixture(methods), {
      leaseId: 'oql_1',
      namespaceIds: ['prj-existing', 'prj-missing'],
      organizationId: 'org_1',
    });
    expect(methods.apply).toHaveBeenCalledOnce();
    expect(methods.mergePatchExisting).toHaveBeenCalledOnce();
    expect(methods.mergePatchExisting).toHaveBeenCalledWith(
      expect.objectContaining({
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: {
          labels: { 'compartment.dev/organization-id': 'org_1' },
          name: kubeNamespaceName('prj-existing'),
        },
      }),
    );
    expect(methods.mergePatchExisting.mock.invocationCallOrder[0]).toBeLessThan(
      complete.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('bounds namespace backfill concurrency across multiple batches', async (): Promise<void> => {
    const namespaceIds: string[] = Array.from(
      { length: 11 },
      (_value: undefined, index: number): string => `prj-${index}`,
    );
    const namespaceIdByName = new Map<string, string>(
      namespaceIds.map((namespaceId: string): [string, string] => [kubeNamespaceName(namespaceId), namespaceId]),
    );
    let active: number = 0;
    let maximumActive: number = 0;
    const methods: RuntimeMethods = runtimeMethods(
      vi.fn().mockImplementation(async (manifest: KubeManifest): Promise<object> => {
        await Promise.resolve();
        if (manifest.kind === 'GlobalCustomQuota') {
          return { status: { conditions: [{ status: 'True', type: 'Ready' }] } };
        }
        const namespaceId: string | undefined = namespaceIdByName.get(manifest.metadata?.name ?? '');
        return {
          metadata: {
            labels: {
              'app.kubernetes.io/managed-by': 'compartment',
              'compartment.dev/namespace-id': namespaceId,
              'compartment.dev/project-id': namespaceId,
            },
          },
        };
      }),
    );
    methods.mergePatchExisting.mockImplementation(async (): Promise<object> => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return {};
    });

    await executeOrganizationQuotaReconcile({} as CompartmentRequester, runtimeFixture(methods), {
      leaseId: 'oql_batches',
      namespaceIds,
      organizationId: 'org_1',
    });

    expect(methods.mergePatchExisting).toHaveBeenCalledTimes(11);
    expect(maximumActive).toBe(10);
  });

  it('fails infrastructure that reports a non-ready condition without reading usage', async (): Promise<void> => {
    const methods: RuntimeMethods = runtimeMethods(
      vi.fn().mockResolvedValue({ status: { conditions: [{ status: 'False', type: 'Ready' }] } }),
    );
    await expect(
      executeOrganizationQuotaReconcile({} as CompartmentRequester, runtimeFixture(methods), {
        leaseId: 'oql_1',
        namespaceIds: [],
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
      mergePatchExisting: vi.fn(),
      read: vi.fn().mockResolvedValue({ status: { conditions: [{ status: 'True', type: 'Ready' }] } }),
    };
    await expect(
      executeOrganizationQuotaReconcile({} as CompartmentRequester, runtimeFixture(methods), {
        leaseId: 'oql_stale',
        namespaceIds: [],
        organizationId: 'org_1',
      }),
    ).rejects.toThrow('lease is no longer current');
  });

  it('rejects a fenced failure completion', async (): Promise<void> => {
    complete.mockResolvedValueOnce({ applied: false });
    const methods: RuntimeMethods = {
      apply: vi.fn().mockRejectedValue(new Error('apply failed')),
      mergePatchExisting: vi.fn(),
      read: vi.fn(),
    };
    await expect(
      executeOrganizationQuotaReconcile({} as CompartmentRequester, runtimeFixture(methods), {
        leaseId: 'oql_stale',
        namespaceIds: [],
        organizationId: 'org_1',
      }),
    ).rejects.toThrow('lease is no longer current');
  });
});

function runtimeFixture(methods: RuntimeMethods): KubeRuntime {
  return Object.assign(Object.create(KubeRuntime.prototype) as KubeRuntime, methods);
}
