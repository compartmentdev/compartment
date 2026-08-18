import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEdgeSnapshotMetrics } from '../src/services/edge-snapshot-metrics.service';
import type { EdgeSnapshotMetrics } from '../src/services/edge-snapshot-metrics.service.types';

afterEach((): void => {
  vi.useRealTimers();
});

describe('edge snapshot metrics', (): void => {
  it('reports restore source, age, persistence, refresh, and expiry failures', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T10:00:05.000Z'));
    const metrics: EdgeSnapshotMetrics = createEdgeSnapshotMetrics();
    metrics.recordRestore('disk', '2026-07-12T10:00:00.000Z');
    metrics.recordPersistenceError();
    metrics.recordRefreshError();
    metrics.recordFailClosedExpiry();

    const output: string = await metrics.registry.metrics();
    expect(output).toContain('compartment_edge_snapshot_age_seconds 5');
    expect(output).toContain('compartment_edge_snapshot_restore_source{source="disk"} 1');
    expect(output).toContain('compartment_edge_snapshot_persistence_errors_total 1');
    expect(output).toContain('compartment_edge_snapshot_refresh_errors_total 1');
    expect(output).toContain('compartment_edge_snapshot_fail_closed_expiry_total 1');
  });

  it('rejects an invalid persisted timestamp without changing restore state', async (): Promise<void> => {
    const metrics: EdgeSnapshotMetrics = createEdgeSnapshotMetrics();

    expect((): void => metrics.recordRestore('disk', 'not-a-timestamp')).toThrow(
      'Invalid Edge snapshot persistedAt timestamp.',
    );

    const output: string = await metrics.registry.metrics();
    expect(output).toContain('compartment_edge_snapshot_age_seconds 0');
    expect(output).toContain('compartment_edge_snapshot_restore_source{source="disk"} 0');
    expect(output).toContain('compartment_edge_snapshot_restore_source{source="api"} 0');
  });
});
