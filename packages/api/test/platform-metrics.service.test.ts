import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { createPrometheusRegistry, type Registry } from '@compartment/utils';
import type {
  PlatformMetricsSnapshot,
  PlatformProvisioningSummaryRow,
} from '../src/queries/platform-metrics.query.types';
import {
  createApiPlatformMetrics,
  observeApiHttpRequest,
  observeDeploymentSubmitToReady,
} from '../src/services/platform-metrics.service';
import type { ApiPlatformMetricsRuntime } from '../src/services/platform-metrics.service.types';
import { ApiSnapshotMetrics } from '../src/services/platform-snapshot-metrics.service';

let runtime: ApiPlatformMetricsRuntime | null = null;

afterEach(async (): Promise<void> => {
  if (runtime !== null) {
    await runtime.stop();
  }
  runtime = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('API platform metrics', (): void => {
  it('serves the cached operator contract with bounded labels and live snapshot age', async (): Promise<void> => {
    const now = new Date('2026-08-18T12:00:00.000Z');
    vi.spyOn(Date, 'now').mockReturnValue(now.getTime());
    const readSnapshot = vi.fn(async (): Promise<PlatformMetricsSnapshot> => await Promise.resolve(snapshot(now)));
    runtime = createApiPlatformMetrics(
      { primaryPool: pool(5, 3, 1), readSnapshot, resourceOperationPool: pool(2, 2, 0) },
      '127.0.0.1',
      0,
    );
    const port: number = await runtime.start();
    observeApiHttpRequest('GET', '/v1/projects/:projectId', 200, 25);
    observeDeploymentSubmitToReady(120);

    vi.mocked(Date.now).mockReturnValue(now.getTime() + 5_000);
    const firstOutput: string = await scrape(port);

    expect(readSnapshot).toHaveBeenCalledTimes(1);
    expect(firstOutput).toContain('compartment_build_queue_deployments{state="queued"} 2');
    expect(firstOutput).toContain(
      'compartment_build_queue_deployments_by_organization{organization_id="org_1",state="active"} 1',
    );
    expect(firstOutput).toContain('compartment_build_queue_oldest_queued_age_seconds 60');
    expect(firstOutput).toContain('compartment_deployments{status="failed"} 0');
    expect(firstOutput).toContain('compartment_project_permanently_unprovisionable 1');
    expect(firstOutput).toContain(
      'compartment_api_http_requests_total{method="GET",route="/v1/projects/:projectId",status_code="200"} 1',
    );
    expect(firstOutput).toContain('compartment_deployment_submit_to_ready_duration_seconds_bucket{le="120"} 1');
    expect(firstOutput).toContain('compartment_api_db_pool_connections{pool="primary",state="total"} 5');
    expect(firstOutput).toContain('compartment_platform_metrics_snapshot_age_seconds 5');

    await scrape(port);
    expect(readSnapshot).toHaveBeenCalledTimes(1);
  });

  it('does not overlap slow snapshot refreshes', async (): Promise<void> => {
    vi.useFakeTimers();
    const secondRefresh = new DeferredValue<PlatformMetricsSnapshot>();
    const readSnapshot = vi
      .fn<() => Promise<PlatformMetricsSnapshot>>()
      .mockResolvedValueOnce(snapshot(new Date()))
      .mockReturnValue(secondRefresh.promise);
    runtime = createApiPlatformMetrics(
      { primaryPool: pool(0, 0, 0), readSnapshot, resourceOperationPool: pool(0, 0, 0) },
      '127.0.0.1',
      0,
    );
    await runtime.start();

    await vi.advanceTimersByTimeAsync(45_000);
    expect(readSnapshot).toHaveBeenCalledTimes(2);

    secondRefresh.resolve(snapshot(new Date()));
    await vi.runOnlyPendingTimersAsync();
  });

  it('removes inactive organization series and keeps global zero series', async (): Promise<void> => {
    const registry: Registry = createPrometheusRegistry('api-test');
    const metrics = new ApiSnapshotMetrics(registry);
    const now = new Date('2026-08-18T12:00:00.000Z');
    metrics.apply(snapshot(now), now);
    metrics.apply(
      { buildQueue: [], deployments: [], provisioning: [], provisioningSummary: emptyProvisioningSummary() },
      now,
    );

    const output: string = await registry.metrics();
    expect(output).not.toContain('organization_id="org_1"');
    expect(output).toContain('compartment_build_queue_deployments{state="queued"} 0');
    expect(output).toContain('compartment_deployments{status="failed"} 0');
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

function pool(totalCount: number, idleCount: number, waitingCount: number): Pool {
  return { idleCount, totalCount, waitingCount } as Pool;
}

function snapshot(now: Date): PlatformMetricsSnapshot {
  return {
    buildQueue: [
      { active: 1, oldestQueuedAt: new Date(now.getTime() - 60_000), organizationId: null, queued: 2, running: 3 },
      {
        active: 1,
        oldestQueuedAt: new Date(now.getTime() - 30_000),
        organizationId: 'org_1',
        queued: 1,
        running: 2,
      },
    ],
    deployments: [{ count: 4, status: 'succeeded' }],
    provisioning: [{ count: 2, state: 'failed' }],
    provisioningSummary: { attempts: 7, permanentlyUnprovisionable: 1 },
  };
}

function emptyProvisioningSummary(): PlatformProvisioningSummaryRow {
  return { attempts: 0, permanentlyUnprovisionable: 0 };
}

async function scrape(port: number): Promise<string> {
  const response: Response = await fetch(`http://127.0.0.1:${port}/metrics`);
  expect(response.status).toBe(200);
  return await response.text();
}
