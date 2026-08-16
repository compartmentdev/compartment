import { resourceReconcileLeaseHeartbeatIntervalMs } from '@compartment/contracts';
import type { CompartmentRequester } from '@compartment/sdk';
import { KubeRuntime, type KubeObservation, type ResourceProjectionRow } from '@compartment/kube-runtime';
import { afterEach, expect, it, vi, type Mock } from 'vitest';
import { runWithResourceReconcileLease } from '../src/services/worker-resource-reconcile-lease.service';
import { scaleDownAndAwaitTermination } from '../src/services/worker-resource-reconcile-observation.service';

const acknowledge: Mock = vi.hoisted((): Mock => vi.fn());

vi.mock('@compartment/sdk', (): object => ({ acknowledgeResourceReconcile: acknowledge }));

afterEach((): void => {
  vi.useRealTimers();
  acknowledge.mockReset();
});

it('aborts reconcile work when a heartbeat no longer owns the lease', async (): Promise<void> => {
  vi.useFakeTimers();
  acknowledge.mockRejectedValue(new Error('Resource reconcile lease is no longer current.'));
  const request: CompartmentRequester = vi.fn() as CompartmentRequester;
  const work: Promise<void> = runWithResourceReconcileLease(
    request,
    'lease-1',
    'operation-1',
    async (signal: AbortSignal): Promise<void> =>
      await new Promise<void>((_resolve: () => void, reject: (error: Error) => void): void => {
        signal.addEventListener(
          'abort',
          (): void => reject(signal.reason instanceof Error ? signal.reason : new Error('Lease lost.')),
          { once: true },
        );
      }),
  );
  const rejected: Promise<void> = expect(work).rejects.toThrow('lease is no longer current');

  await vi.advanceTimersByTimeAsync(resourceReconcileLeaseHeartbeatIntervalMs);
  await rejected;
});

it('does not mutate Kubernetes after the reconcile lease is lost', async (): Promise<void> => {
  const controller: AbortController = new AbortController();
  const apply: Mock = vi.fn();
  const runtime: KubeRuntime = Object.create(KubeRuntime.prototype) as KubeRuntime;
  vi.spyOn(runtime, 'apply').mockImplementation(apply);
  controller.abort(new Error('Resource reconcile lease is no longer current.'));

  await expect(
    scaleDownAndAwaitTermination(runtime, {} as KubeObservation, {} as ResourceProjectionRow, controller.signal),
  ).rejects.toThrow('lease is no longer current');
  expect(apply).not.toHaveBeenCalled();
});
