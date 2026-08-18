import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkerBuildResult } from '../src/services/worker-iteration.types';
import {
  startWorkerPlatformMetrics,
  trackWorkerBuildCompletion,
} from '../src/services/worker-platform-metrics.service';
import type { WorkerPlatformMetricsRuntime } from '../src/services/worker-platform-metrics.service.types';
import { createWorkerTestConfig } from './worker-config-test.fixtures';

let runtime: WorkerPlatformMetricsRuntime | null = null;

afterEach(async (): Promise<void> => {
  if (runtime !== null) {
    await runtime.server.close();
  }
  runtime = null;
});

describe('worker platform metrics', (): void => {
  it('records handled build failures from the completion result', async (): Promise<void> => {
    runtime = await startWorkerPlatformMetrics(createWorkerTestConfig({ metricsPort: 0 }));
    const activeBuilds = new Set<Promise<void>>();
    const completion = new DeferredValue<WorkerBuildResult>();

    trackWorkerBuildCompletion(activeBuilds, completion.promise, vi.fn());
    const activeOutput: string = await scrape(runtime.server.port);
    expect(activeOutput).toContain('compartment_worker_active_builds 1');
    expect(activeOutput).toContain('compartment_build_queue_concurrency_limit{scope="global"} 2');
    expect(activeOutput).toContain('compartment_build_queue_concurrency_limit{scope="organization"} 1');

    completion.resolve('failed');
    await vi.waitFor((): void => expect(activeBuilds.size).toBe(0));
    trackWorkerBuildCompletion(activeBuilds, Promise.resolve('succeeded'), vi.fn());
    await vi.waitFor((): void => expect(activeBuilds.size).toBe(0));
    const handleFailure = vi.fn();
    trackWorkerBuildCompletion(activeBuilds, Promise.reject(new Error('unexpected completion failure')), handleFailure);
    await vi.waitFor((): void => expect(activeBuilds.size).toBe(0));

    const output: string = await scrape(runtime.server.port);
    expect(output).toContain('compartment_worker_active_builds 0');
    expect(output).toContain('compartment_worker_builds_total{result="failed"} 2');
    expect(output).toContain('compartment_worker_builds_total{result="succeeded"} 1');
    expect(handleFailure).toHaveBeenCalledOnce();
  });
});

class DeferredValue<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;

  constructor() {
    let resolvePromise: ((value: T) => void) | undefined;
    this.promise = new Promise<T>((resolve: (value: T) => void): void => {
      resolvePromise = resolve;
    });
    this.resolve = (value: T): void => resolvePromise!(value);
  }
}

async function scrape(port: number): Promise<string> {
  return await (await fetch(`http://127.0.0.1:${port}/metrics`)).text();
}
