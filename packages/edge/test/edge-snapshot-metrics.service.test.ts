import { describe, expect, it } from 'vitest';
import { createEdgeSnapshotMetrics } from '../src/services/edge-snapshot-metrics.service';
import type { EdgeSnapshotMetrics } from '../src/services/edge-snapshot-metrics.service.types';

describe('edge snapshot metrics', (): void => {
  it('reports restore source, age, persistence, refresh, and expiry failures', (): void => {
    const metrics: EdgeSnapshotMetrics = createEdgeSnapshotMetrics();
    metrics.recordRestore('disk', '2026-07-12T10:00:00.000Z');
    metrics.recordPersistenceError();
    metrics.recordRefreshError();
    metrics.recordFailClosedExpiry();

    const output: string = metrics.render(new Date('2026-07-12T10:00:05.000Z'));
    expect(output).toContain('compartment_edge_snapshot_age_seconds 5');
    expect(output).toContain('compartment_edge_snapshot_restore_source{source="disk"} 1');
    expect(output).toContain('compartment_edge_snapshot_persistence_errors_total 1');
    expect(output).toContain('compartment_edge_snapshot_refresh_errors_total 1');
    expect(output).toContain('compartment_edge_snapshot_fail_closed_expiry_total 1');
  });
});
