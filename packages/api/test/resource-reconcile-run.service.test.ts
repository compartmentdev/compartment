import type { ResourceReconcileIntent } from '@compartment/contracts';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ProjectResourceRow } from '../src/queries/resources.query.types';
import {
  requestResourceReconcile,
  waitForResourceClaimIdentities,
  waitForResourceBootstrap,
  waitForResourceBootstrapForCleanup,
  waitForResourceRunning,
  waitForResourceReconcile,
} from '../src/services/resource-reconcile-run.service';

const createRun: Mock = vi.hoisted((): Mock => vi.fn());
const readRunState: Mock = vi.hoisted((): Mock => vi.fn());
const readWaitState: Mock = vi.hoisted((): Mock => vi.fn());
const readBootstrapSettlement: Mock = vi.hoisted((): Mock => vi.fn());
const readReconcileSettlement: Mock = vi.hoisted((): Mock => vi.fn());

vi.mock('node:timers/promises', (): object => ({
  setTimeout: async (delayMs: number): Promise<void> =>
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, delayMs);
    }),
}));
vi.mock('../src/queries/resource-reconcile-create.query', (): object => ({
  createResourceReconcileRun: createRun,
}));
vi.mock('../src/queries/resource-reconcile-runs.query', (): object => ({
  acknowledgeResourceReconcileRun: vi.fn(),
  claimResourceReconcileRun: vi.fn(),
  readResourceBootstrapSettlement: readBootstrapSettlement,
  readResourceReconcileSettlement: readReconcileSettlement,
  readResourceReconcileRunState: readRunState,
  resourceReconcileLeaseDurationMs: 600_000,
}));
vi.mock('../src/queries/resource-reconcile-wait.query', (): object => ({
  readResourceReconcileRunWaitState: readWaitState,
}));
vi.mock('../src/queries/project-provisioning-policy', (): object => ({
  projectProvisioningAttemptLimit: 3,
  projectProvisioningLeaseDurationMs: 420_000,
  projectProvisioningRetryDelayMs: 10_000,
}));
describe('resource reconcile run boundary', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    readWaitState.mockResolvedValue({
      failureMessage: null,
      operationType: 'reconcile',
      phase: 'reconcile-pending',
      predecessorCount: 0,
      predecessorToken: 'empty',
    });
  });

  it('refuses ordinary reconcile before the implicit backup claim is bootstrapped', async (): Promise<void> => {
    const resource: ProjectResourceRow = { expectedClaimsJson: '[]', name: 'postgres' } as ProjectResourceRow;

    await expect(requestResourceReconcile('operation', intent(), resource)).rejects.toMatchObject({
      code: 'invalid_deploy_config',
      message:
        'Resource "postgres" is not bootstrapped yet. Run `compartment resource bootstrap --resource postgres` first.',
    });
    expect(createRun).not.toHaveBeenCalled();
  });

  it('keeps the API waiter alive beyond two minutes for a longer configured readiness budget', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      readRunState.mockResolvedValue(null);
      const waiting: Promise<void> = waitForResourceReconcile('operation');
      let settled: boolean = false;
      void waiting.then(
        (): void => {
          settled = true;
        },
        (): void => {
          settled = true;
        },
      );

      await vi.advanceTimersByTimeAsync(450_001);
      expect(settled).toBe(false);
      readRunState.mockResolvedValue({ failureMessage: null, phase: 'succeeded' });
      await vi.advanceTimersByTimeAsync(5_000);
      await waiting;
    } finally {
      vi.useRealTimers();
    }
  });

  it('backs off database reads while waiting for a long-running reconcile', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      readRunState.mockResolvedValue(null);
      const waiting: Promise<void> = waitForResourceReconcile('operation');
      for (let elapsedSeconds: number = 0; elapsedSeconds < 120; elapsedSeconds += 1) {
        await vi.advanceTimersByTimeAsync(1_000);
      }

      expect(readRunState.mock.calls.length).toBeLessThan(40);
      readRunState.mockResolvedValue({ failureMessage: null, phase: 'succeeded' });
      await vi.advanceTimersByTimeAsync(5_000);
      await waiting;
    } finally {
      vi.useRealTimers();
    }
  });

  it('refreshes queue progress less often than it polls state by primary key', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      readRunState.mockResolvedValue({ failureMessage: null, phase: 'reconcile-pending' });
      const waiting: Promise<void> = waitForResourceReconcile('operation');
      await vi.advanceTimersByTimeAsync(35_000);
      expect(readWaitState.mock.calls.length).toBeGreaterThan(1);
      expect(readWaitState.mock.calls.length).toBeLessThan(readRunState.mock.calls.length);

      readRunState.mockResolvedValue({ failureMessage: null, phase: 'succeeded' });
      await vi.advanceTimersByTimeAsync(5_000);
      await waiting;
    } finally {
      vi.useRealTimers();
    }
  });

  it('budgets for serialized reconcile work already ahead of the requested operation', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      readWaitState.mockResolvedValue({
        failureMessage: null,
        operationType: 'reconcile',
        phase: 'reconcile-pending',
        predecessorCount: 1,
        predecessorToken: 'one',
      });
      readRunState.mockResolvedValue({ failureMessage: null, phase: 'reconcile-pending' });
      let settled: boolean = false;
      const waiting: Promise<void> = waitForResourceReconcile('operation');
      void waiting.then(
        (): void => {
          settled = true;
        },
        (): void => {
          settled = true;
        },
      );

      await vi.advanceTimersByTimeAsync(900_000);
      expect(settled).toBe(false);
      readRunState.mockResolvedValue({ failureMessage: null, phase: 'succeeded' });
      await vi.advanceTimersByTimeAsync(5_000);
      await waiting;
    } finally {
      vi.useRealTimers();
    }
  });

  it('budgets lease expiry before a crashed reconcile can be reclaimed', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      readRunState.mockResolvedValue({ failureMessage: null, phase: 'running' });
      let settled: boolean = false;
      const waiting: Promise<void> = waitForResourceReconcile('operation');
      void waiting.then(
        (): void => {
          settled = true;
        },
        (): void => {
          settled = true;
        },
      );

      await vi.advanceTimersByTimeAsync(1_000_000);
      expect(settled).toBe(false);
      readRunState.mockResolvedValue({ failureMessage: null, phase: 'succeeded' });
      await vi.advanceTimersByTimeAsync(5_000);
      await waiting;
    } finally {
      vi.useRealTimers();
    }
  });

  it('extends the wait boundary when a previously invisible predecessor commits', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      readWaitState
        .mockResolvedValueOnce({
          failureMessage: null,
          operationType: 'reconcile',
          phase: 'reconcile-pending',
          predecessorCount: 0,
          predecessorToken: 'empty',
        })
        .mockResolvedValue({
          failureMessage: null,
          operationType: 'reconcile',
          phase: 'reconcile-pending',
          predecessorCount: 1,
          predecessorToken: 'late-predecessor',
        });
      readRunState.mockResolvedValue({ failureMessage: null, phase: 'reconcile-pending' });
      let settled: boolean = false;
      const waiting: Promise<void> = waitForResourceReconcile('operation');
      void waiting.then(
        (): void => {
          settled = true;
        },
        (): void => {
          settled = true;
        },
      );

      await vi.advanceTimersByTimeAsync(1_500_000);
      expect(settled).toBe(false);
      readRunState.mockResolvedValue({ failureMessage: null, phase: 'succeeded' });
      await vi.advanceTimersByTimeAsync(5_000);
      await waiting;
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps bootstrap settlement alive beyond the worker observation boundary', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const resource: ProjectResourceRow = { expectedClaimsJson: '[]' } as ProjectResourceRow;
      readBootstrapSettlement.mockResolvedValue({
        provisioningAttempts: 0,
        provisioningState: 'succeeded',
        resource,
        state: { failureMessage: null, operationId: 'bootstrap-operation', phase: 'running' },
      });
      readWaitState.mockResolvedValue({
        failureMessage: null,
        operationType: 'bootstrap',
        phase: 'running',
        predecessorCount: 0,
        predecessorToken: 'empty',
      });
      readRunState.mockResolvedValue({ failureMessage: null, phase: 'running' });
      const waiting: Promise<ProjectResourceRow> = waitForResourceBootstrap('resource');
      let settled: boolean = false;
      void waiting.then(
        (): void => {
          settled = true;
        },
        (): void => {
          settled = true;
        },
      );

      await vi.advanceTimersByTimeAsync(600_001);
      expect(settled).toBe(false);
      const bootstrapped: ProjectResourceRow = { expectedClaimsJson: '[{"uid":"claim"}]' } as ProjectResourceRow;
      readBootstrapSettlement.mockResolvedValue({
        provisioningAttempts: 0,
        provisioningState: 'succeeded',
        resource: bootstrapped,
        state: null,
      });
      readRunState.mockResolvedValue({ failureMessage: null, phase: 'succeeded' });
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(waiting).resolves.toBe(bootstrapped);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for a bootstrap run to persist claim identities before returning', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const resource: ProjectResourceRow = { expectedClaimsJson: '[]' } as ProjectResourceRow;
      readBootstrapSettlement.mockResolvedValue({
        provisioningAttempts: 0,
        provisioningState: 'succeeded',
        resource,
        state: null,
      });
      const waiting: Promise<ProjectResourceRow> = waitForResourceClaimIdentities('resource');
      let settled: boolean = false;
      void waiting.then(
        (): void => {
          settled = true;
        },
        (): void => {
          settled = true;
        },
      );

      await vi.advanceTimersByTimeAsync(5_000);
      expect(settled).toBe(false);
      const bootstrapped: ProjectResourceRow = { expectedClaimsJson: '[{"uid":"claim"}]' } as ProjectResourceRow;
      readBootstrapSettlement.mockResolvedValue({
        provisioningAttempts: 0,
        provisioningState: 'succeeded',
        resource: bootstrapped,
        state: null,
      });
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(waiting).resolves.toBe(bootstrapped);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for an active bootstrap before returning claim identities', async (): Promise<void> => {
    const resource: ProjectResourceRow = { expectedClaimsJson: '[]' } as ProjectResourceRow;
    const bootstrapped: ProjectResourceRow = { expectedClaimsJson: '[{"uid":"claim"}]' } as ProjectResourceRow;
    readBootstrapSettlement
      .mockResolvedValueOnce({
        provisioningAttempts: 0,
        provisioningState: 'succeeded',
        resource,
        state: { failureMessage: null, operationId: 'bootstrap-operation', phase: 'running' },
      })
      .mockResolvedValue({
        provisioningAttempts: 0,
        provisioningState: 'succeeded',
        resource: bootstrapped,
        state: null,
      });
    readRunState.mockResolvedValue({ failureMessage: null, phase: 'succeeded' });

    await expect(waitForResourceClaimIdentities('resource')).resolves.toBe(bootstrapped);
    expect(readRunState).toHaveBeenCalledWith('bootstrap-operation');
  });

  it('reports a failed bootstrap while waiting for claim identities', async (): Promise<void> => {
    readBootstrapSettlement.mockResolvedValue({
      provisioningAttempts: 1,
      provisioningState: 'failed',
      resource: { expectedClaimsJson: '[]' } as ProjectResourceRow,
      state: { failureMessage: 'bootstrap failed', operationId: 'bootstrap-operation', phase: 'failed' },
    });

    await expect(waitForResourceClaimIdentities('resource')).rejects.toThrow('bootstrap failed');
  });

  it('refuses a successful bootstrap without claim identities', async (): Promise<void> => {
    readBootstrapSettlement.mockResolvedValue({
      provisioningAttempts: 0,
      provisioningState: 'succeeded',
      resource: { expectedClaimsJson: '[]' } as ProjectResourceRow,
      state: { failureMessage: null, operationId: 'bootstrap-operation', phase: 'succeeded' },
    });

    await expect(waitForResourceClaimIdentities('resource')).rejects.toThrow(
      'Kubernetes resource bootstrap completed without persistent claim identities.',
    );
  });

  it('keeps bootstrap settlement alive behind globally queued resource work', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const resource: ProjectResourceRow = { expectedClaimsJson: '[]' } as ProjectResourceRow;
      readBootstrapSettlement.mockResolvedValue({
        provisioningAttempts: 0,
        provisioningState: 'succeeded',
        resource,
        state: { failureMessage: null, operationId: 'bootstrap-operation', phase: 'bootstrap-pending' },
      });
      readWaitState.mockResolvedValue({
        failureMessage: null,
        operationType: 'bootstrap',
        phase: 'bootstrap-pending',
        predecessorCount: 1,
        predecessorToken: 'one',
      });
      readRunState.mockResolvedValue({ failureMessage: null, phase: 'bootstrap-pending' });
      let settled: boolean = false;
      const waiting: Promise<ProjectResourceRow> = waitForResourceBootstrap('resource');
      void waiting.then(
        (): void => {
          settled = true;
        },
        (): void => {
          settled = true;
        },
      );

      await vi.advanceTimersByTimeAsync(2_000_000);
      expect(settled).toBe(false);
      const bootstrapped: ProjectResourceRow = { expectedClaimsJson: '[{"uid":"claim"}]' } as ProjectResourceRow;
      readRunState.mockResolvedValue({ failureMessage: null, phase: 'succeeded' });
      readBootstrapSettlement.mockResolvedValue({
        provisioningAttempts: 0,
        provisioningState: 'succeeded',
        resource: bootstrapped,
        state: null,
      });
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(waiting).resolves.toBe(bootstrapped);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports the failed follow-up reconcile while waiting for a restored resource', async (): Promise<void> => {
    const resource: ProjectResourceRow = { status: 'starting' } as ProjectResourceRow;
    readReconcileSettlement.mockResolvedValue({
      provisioningAttempts: 0,
      provisioningState: 'succeeded',
      resource,
      state: { failureMessage: 'rollout failed', phase: 'failed' },
    });

    await expect(waitForResourceRunning('resource')).rejects.toThrow('rollout failed');
  });

  it('refuses a terminal stopped reconcile instead of polling it forever as running', async (): Promise<void> => {
    const resource: ProjectResourceRow = { status: 'stopped' } as ProjectResourceRow;
    readReconcileSettlement
      .mockResolvedValueOnce({
        provisioningAttempts: 0,
        provisioningState: 'succeeded',
        resource,
        state: { failureMessage: null, operationId: 'stopped-operation', phase: 'succeeded' },
      })
      .mockRejectedValue(new Error('polled terminal settlement twice'));
    readRunState.mockResolvedValue({ failureMessage: null, phase: 'succeeded' });

    await expect(waitForResourceRunning('resource')).rejects.toThrow(
      'Kubernetes resource settled as stopped while waiting for running.',
    );
    expect(readReconcileSettlement).toHaveBeenCalledTimes(1);
  });

  it('keeps restored-resource startup alive behind globally queued resource work', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const resource: ProjectResourceRow = { status: 'starting' } as ProjectResourceRow;
      readReconcileSettlement.mockResolvedValue({
        provisioningAttempts: 0,
        provisioningState: 'succeeded',
        resource,
        state: { failureMessage: null, operationId: 'follow-up-operation', phase: 'reconcile-pending' },
      });
      readWaitState.mockResolvedValue({
        failureMessage: null,
        operationType: 'reconcile',
        phase: 'reconcile-pending',
        predecessorCount: 1,
        predecessorToken: 'one',
      });
      readRunState.mockResolvedValue({ failureMessage: null, phase: 'reconcile-pending' });
      let settled: boolean = false;
      const waiting: Promise<ProjectResourceRow> = waitForResourceRunning('resource');
      void waiting.then(
        (): void => {
          settled = true;
        },
        (): void => {
          settled = true;
        },
      );

      await vi.advanceTimersByTimeAsync(1_600_000);
      expect(settled).toBe(false);
      const running: ProjectResourceRow = { status: 'running' } as ProjectResourceRow;
      readRunState.mockResolvedValue({ failureMessage: null, phase: 'succeeded' });
      readReconcileSettlement.mockResolvedValue({
        provisioningAttempts: 0,
        provisioningState: 'succeeded',
        resource: running,
        state: { failureMessage: null, operationId: 'follow-up-operation', phase: 'succeeded' },
      });
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(waiting).resolves.toBe(running);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not report a restored resource running while its latest reconcile is still pending', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const resource: ProjectResourceRow = { status: 'running' } as ProjectResourceRow;
      readReconcileSettlement.mockResolvedValue({
        provisioningAttempts: 0,
        provisioningState: 'succeeded',
        resource,
        state: { failureMessage: null, operationId: 'latest-operation', phase: 'reconcile-pending' },
      });
      readRunState.mockResolvedValue({ failureMessage: null, phase: 'reconcile-pending' });
      const waiting: Promise<ProjectResourceRow> = waitForResourceRunning('resource');
      let settled: boolean = false;
      void waiting.finally((): void => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(5_000);
      expect(settled).toBe(false);
      readRunState.mockResolvedValue({ failureMessage: null, phase: 'succeeded' });
      readReconcileSettlement.mockResolvedValue({
        provisioningAttempts: 0,
        provisioningState: 'succeeded',
        resource,
        state: { failureMessage: null, operationId: 'latest-operation', phase: 'succeeded' },
      });
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(waiting).resolves.toBe(resource);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets cleanup finish after terminal provisioning failed before runtime creation', async (): Promise<void> => {
    const resource: ProjectResourceRow = { expectedClaimsJson: '[]' } as ProjectResourceRow;
    readBootstrapSettlement.mockResolvedValue({
      provisioningAttempts: 3,
      provisioningState: 'failed',
      resource,
      state: { failureMessage: 'Project is unprovisionable', phase: 'failed' },
    });

    await expect(waitForResourceBootstrapForCleanup('resource')).resolves.toBe(resource);
    await expect(waitForResourceBootstrap('resource')).rejects.toThrow('Project is unprovisionable');
  });

  it('re-evaluates cleanup policy when provisioning fails while bootstrap is being awaited', async (): Promise<void> => {
    const resource: ProjectResourceRow = { expectedClaimsJson: '[]' } as ProjectResourceRow;
    readBootstrapSettlement
      .mockResolvedValueOnce({
        provisioningAttempts: 2,
        provisioningState: 'running',
        resource,
        state: { failureMessage: null, operationId: 'bootstrap-operation', phase: 'running' },
      })
      .mockResolvedValue({
        provisioningAttempts: 3,
        provisioningState: 'failed',
        resource,
        state: {
          failureMessage: 'Project is unprovisionable',
          operationId: 'bootstrap-operation',
          phase: 'failed',
        },
      });
    readWaitState.mockResolvedValue({
      failureMessage: null,
      operationType: 'bootstrap',
      phase: 'running',
      predecessorCount: 0,
      predecessorToken: 'empty',
    });
    readRunState.mockResolvedValue({ failureMessage: 'Project is unprovisionable', phase: 'failed' });

    await expect(waitForResourceBootstrapForCleanup('resource')).resolves.toBe(resource);
  });

  it('does not treat archive cancellation as bootstrap success outside cleanup', async (): Promise<void> => {
    const resource: ProjectResourceRow = { expectedClaimsJson: '[]' } as ProjectResourceRow;
    readBootstrapSettlement.mockResolvedValue({
      provisioningAttempts: 0,
      provisioningState: 'succeeded',
      resource,
      state: {
        failureMessage: 'Resource reconciliation was canceled because the project was archived.',
        phase: 'failed',
      },
    });

    await expect(waitForResourceBootstrap('resource')).rejects.toThrow('project was archived');
    await expect(waitForResourceBootstrapForCleanup('resource')).resolves.toBe(resource);
  });
});

function intent(): ResourceReconcileIntent {
  return {
    command: [],
    deleteData: false,
    environmentId: 'env',
    env: {},
    image: 'postgres:17',
    namespaceId: 'project',
    operation: 'reconcile',
    ports: [],
    readiness: null,
    replicas: 1,
    resourceId: 'resource',
    secretId: 'resource',
    volumes: [],
  };
}
