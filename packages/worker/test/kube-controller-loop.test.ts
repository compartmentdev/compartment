import pino from 'pino';
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { WorkerConfig } from '../src/config';
import { runKubeControllerLoop } from '../src/kube-controller-loop';

type ReconcileKube = () => Promise<boolean>;

describe('Kubernetes controller loop', (): void => {
  it('continues reconciling after the control-plane API is temporarily unavailable', async (): Promise<void> => {
    const stop: Error = new Error('stop after recovered iteration');
    const reconcile: Mock<ReconcileKube> = vi
      .fn<ReconcileKube>()
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockRejectedValueOnce(stop);
    let timerCount: number = 0;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback: () => void): NodeJS.Timeout => {
      timerCount += 1;
      if (timerCount === 2) {
        throw stop;
      }
      callback();
      return {} as NodeJS.Timeout;
    });

    await expect(
      runKubeControllerLoop(
        { pollIntervalMs: 1 } as WorkerConfig,
        pino({ level: 'silent' }),
        {
          reconcile,
        },
        new AbortController().signal,
      ),
    ).rejects.toBe(stop);
    expect(reconcile).toHaveBeenCalledTimes(2);
  });
});
