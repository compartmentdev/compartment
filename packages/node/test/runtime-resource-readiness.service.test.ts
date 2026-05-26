import { afterEach, describe, expect, it, vi } from 'vitest';
import { continueResourceReadinessPolling } from '../src/services/runtime-resource-readiness.service';

afterEach((): void => {
  vi.useRealTimers();
});

describe('continueResourceReadinessPolling', (): void => {
  it('does not sleep when the readiness deadline has already been reached', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    await expect(continueResourceReadinessPolling(1_000)).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops polling when the sleep reaches the readiness deadline', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    const polling: Promise<boolean> = continueResourceReadinessPolling(1_500);

    await vi.advanceTimersByTimeAsync(500);

    await expect(polling).resolves.toBe(false);
  });

  it('continues polling when the deadline is still in the future after sleeping', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    const polling: Promise<boolean> = continueResourceReadinessPolling(1_501);

    await vi.advanceTimersByTimeAsync(500);

    await expect(polling).resolves.toBe(true);
  });
});
