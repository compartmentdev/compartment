import { resourceReconcileLeaseHeartbeatIntervalMs } from '@compartment/contracts';
import type { CompartmentRequester } from '@compartment/sdk';
import type * as CompartmentSdk from '@compartment/sdk';
import { KubeRuntime, type KubeObservation, type ResourceProjectionRow } from '@compartment/kube-runtime';
import { afterEach, expect, it, vi, type Mock } from 'vitest';
import { runWithResourceReconcileLease } from '../src/services/worker-resource-reconcile-lease.service';
import { scaleDownAndAwaitTermination } from '../src/services/worker-resource-reconcile-observation.service';
import { resourceReconcileRequestError } from './resource-reconcile-request-error.fixture';

const acknowledge: Mock = vi.hoisted((): Mock => vi.fn());

vi.mock(
  '@compartment/sdk',
  async (loadOriginal: () => Promise<typeof CompartmentSdk>): Promise<typeof CompartmentSdk> => {
    const original: typeof CompartmentSdk = await loadOriginal();
    return { ...original, acknowledgeResourceReconcile: acknowledge };
  },
);

afterEach((): void => {
  vi.useRealTimers();
  acknowledge.mockReset();
});

it('aborts reconcile work when a heartbeat no longer owns the lease', async (): Promise<void> => {
  vi.useFakeTimers();
  acknowledge.mockRejectedValue(resourceReconcileRequestError(409));
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

it('retries transient heartbeat failures before aborting reconcile work', async (): Promise<void> => {
  vi.useFakeTimers();
  acknowledge
    .mockRejectedValueOnce(resourceReconcileRequestError(502))
    .mockRejectedValueOnce(resourceReconcileRequestError(502))
    .mockResolvedValueOnce({});
  let finishWork: () => void = (): void => undefined;
  const work: Promise<void> = runWithResourceReconcileLease(
    vi.fn() as CompartmentRequester,
    'lease-1',
    'operation-1',
    async (): Promise<void> =>
      await new Promise<void>((resolve: () => void): void => {
        finishWork = resolve;
      }),
  );

  await vi.advanceTimersByTimeAsync(resourceReconcileLeaseHeartbeatIntervalMs + 2_000);
  expect(acknowledge).toHaveBeenCalledTimes(3);
  finishWork();
  await work;
});

it('treats exhausted heartbeat retries as lease loss', async (): Promise<void> => {
  vi.useFakeTimers();
  acknowledge.mockRejectedValue(resourceReconcileRequestError(502));
  const work: Promise<void> = runWithResourceReconcileLease(
    vi.fn() as CompartmentRequester,
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
  const rejected: Promise<void> = expect(work).rejects.toThrow('could not be renewed after 3 attempts');

  await vi.advanceTimersByTimeAsync(resourceReconcileLeaseHeartbeatIntervalMs + 2_000);
  await rejected;
  expect(acknowledge).toHaveBeenCalledTimes(3);
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
