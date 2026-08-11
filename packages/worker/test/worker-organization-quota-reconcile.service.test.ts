import type { OrganizationQuotaReconcileTarget } from '@compartment/contracts';
import { KubeRuntime, type KubeManifest } from '@compartment/kube-runtime';
import { completeOrganizationQuotaReconcile, type CompartmentRequester } from '@compartment/sdk';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { executeOrganizationQuotaReconcile as executeConfiguredOrganizationQuotaReconcile } from '../src/services/worker-organization-quota-reconcile.service';
import { testOrganizationQuota } from './worker-config-test.fixtures';

const complete: Mock = vi.hoisted((): Mock => vi.fn());

async function executeOrganizationQuotaReconcile(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: OrganizationQuotaReconcileTarget,
): Promise<void> {
  await executeConfiguredOrganizationQuotaReconcile(request, runtime, target, testOrganizationQuota);
}

vi.mock('@compartment/sdk', (): object => ({ completeOrganizationQuotaReconcile: complete }));

interface RuntimeMethods {
  apply: Mock;
  read: Mock;
}

function runtimeMethods(read: Mock): RuntimeMethods {
  return {
    apply: vi.fn().mockImplementation(({ objects }: { objects: KubeManifest[] }): KubeManifest[] =>
      objects.map(
        (object: KubeManifest, index: number): KubeManifest => ({
          ...object,
          metadata: { ...object.metadata, generation: index + 1 },
        }),
      ),
    ),
    read,
  };
}

describe('organization quota reconciliation', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    complete.mockResolvedValue({ applied: true });
  });

  it('completes only after every quota reports infrastructure readiness', async (): Promise<void> => {
    const methods: RuntimeMethods = runtimeMethods(
      vi.fn().mockImplementation((manifest: KubeManifest): object => ({
        status: {
          conditions: [{ status: 'True', type: 'Ready' }],
          observedGeneration: manifest.metadata?.generation,
        },
      })),
    );
    await executeOrganizationQuotaReconcile({} as CompartmentRequester, runtimeFixture(methods), {
      leaseId: 'oql_1',
      organizationId: 'org_1',
    });
    expect(methods.apply).toHaveBeenCalledOnce();
    const applyInput = methods.apply.mock.calls[0]?.[0] as { objects: KubeManifest[] };
    expect(applyInput.objects).toHaveLength(5);
    for (const object of applyInput.objects) {
      expect(object.metadata?.annotations?.['reconcile.projectcapsule.dev/requestedAt']).toMatch(
        /^\d{4}-\d{2}-\d{2}T/u,
      );
    }
    expect(methods.read).toHaveBeenCalledTimes(5);
    expect(completeOrganizationQuotaReconcile).toHaveBeenCalledWith(expect.anything(), {
      leaseId: 'oql_1',
      organizationId: 'org_1',
      status: 'succeeded',
    });
  });

  it('applies changed capacity to an existing organization quota target', async (): Promise<void> => {
    const methods: RuntimeMethods = runtimeMethods(
      vi.fn().mockImplementation((manifest: KubeManifest): object => ({
        status: {
          conditions: [{ status: 'True', type: 'Ready' }],
          observedGeneration: manifest.metadata?.generation,
        },
      })),
    );
    await executeConfiguredOrganizationQuotaReconcile(
      {} as CompartmentRequester,
      runtimeFixture(methods),
      { leaseId: 'oql_existing', organizationId: 'org_existing' },
      { ...testOrganizationQuota, requestsMemory: '3Gi' },
    );

    const applyInput = methods.apply.mock.calls[0]?.[0] as { objects: KubeManifest[] };
    const requestsMemoryQuota: KubeManifest | undefined = applyInput.objects.find(
      (object: KubeManifest): boolean => object.metadata?.name?.includes('requests-memory') === true,
    );
    expect(requestsMemoryQuota?.spec).toMatchObject({ limit: '3Gi' });
  });

  it('waits for the quota controller to publish readiness after apply', async (): Promise<void> => {
    vi.useFakeTimers();
    const methods: RuntimeMethods = runtimeMethods(
      vi
        .fn()
        .mockResolvedValueOnce({ status: { conditions: [] } })
        .mockImplementation((manifest: KubeManifest): object => ({
          status: {
            conditions: [{ status: 'True', type: 'Ready' }],
            observedGeneration: manifest.metadata?.generation,
          },
        })),
    );
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

  it('does not accept readiness reported for an older quota generation', async (): Promise<void> => {
    vi.useFakeTimers();
    const methods: RuntimeMethods = runtimeMethods(
      vi
        .fn()
        .mockResolvedValueOnce({
          status: { conditions: [{ status: 'True', type: 'Ready' }], observedGeneration: 0 },
        })
        .mockImplementation((manifest: KubeManifest): object => ({
          status: {
            conditions: [{ status: 'True', type: 'Ready' }],
            observedGeneration: manifest.metadata?.generation,
          },
        })),
    );
    const reconciliation: Promise<void> = executeOrganizationQuotaReconcile(
      {} as CompartmentRequester,
      runtimeFixture(methods),
      { leaseId: 'oql_1', organizationId: 'org_1' },
    );
    await vi.runAllTimersAsync();
    await reconciliation;
    vi.useRealTimers();
    expect(methods.read).toHaveBeenCalledTimes(6);
  });

  it('does not accept failure reported for an older quota generation', async (): Promise<void> => {
    vi.useFakeTimers();
    const methods: RuntimeMethods = runtimeMethods(
      vi
        .fn()
        .mockResolvedValueOnce({
          status: { conditions: [{ status: 'False', type: 'Ready' }], observedGeneration: 0 },
        })
        .mockImplementation((manifest: KubeManifest): object => ({
          status: {
            conditions: [{ status: 'True', type: 'Ready' }],
            observedGeneration: manifest.metadata?.generation,
          },
        })),
    );
    const reconciliation: Promise<void> = executeOrganizationQuotaReconcile(
      {} as CompartmentRequester,
      runtimeFixture(methods),
      { leaseId: 'oql_1', organizationId: 'org_1' },
    );
    await vi.runAllTimersAsync();
    await reconciliation;
    vi.useRealTimers();
    expect(methods.read).toHaveBeenCalledTimes(6);
  });

  it('waits for Capsule to consume the current reconcile request', async (): Promise<void> => {
    vi.useFakeTimers();
    const methods: RuntimeMethods = runtimeMethods(
      vi
        .fn()
        .mockImplementationOnce((manifest: KubeManifest): object => ({
          metadata: { annotations: manifest.metadata?.annotations },
          status: {
            conditions: [{ status: 'True', type: 'Ready' }],
            observedGeneration: manifest.metadata?.generation,
          },
        }))
        .mockImplementation((manifest: KubeManifest): object => ({
          status: {
            conditions: [{ status: 'True', type: 'Ready' }],
            observedGeneration: manifest.metadata?.generation,
          },
        })),
    );
    const reconciliation: Promise<void> = executeOrganizationQuotaReconcile(
      {} as CompartmentRequester,
      runtimeFixture(methods),
      { leaseId: 'oql_1', organizationId: 'org_1' },
    );
    await vi.runAllTimersAsync();
    await reconciliation;
    vi.useRealTimers();
    expect(methods.read).toHaveBeenCalledTimes(6);
  });

  it('fails infrastructure that reports a non-ready condition without reading usage', async (): Promise<void> => {
    const methods: RuntimeMethods = runtimeMethods(
      vi.fn().mockImplementation((manifest: KubeManifest): object => ({
        status: {
          conditions: [{ status: 'False', type: 'Ready' }],
          observedGeneration: manifest.metadata?.generation,
        },
      })),
    );
    await expect(
      executeOrganizationQuotaReconcile({} as CompartmentRequester, runtimeFixture(methods), {
        leaseId: 'oql_1',
        organizationId: 'org_1',
      }),
    ).rejects.toThrow('Organization quota reconciliation failed for org_1');
    expect(methods.apply).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ status: 'failed' }));
  });

  it('rejects a fenced success completion', async (): Promise<void> => {
    complete.mockResolvedValueOnce({ applied: false });
    const methods: RuntimeMethods = runtimeMethods(
      vi.fn().mockImplementation((manifest: KubeManifest): object => ({
        status: {
          conditions: [{ status: 'True', type: 'Ready' }],
          observedGeneration: manifest.metadata?.generation,
        },
      })),
    );
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
