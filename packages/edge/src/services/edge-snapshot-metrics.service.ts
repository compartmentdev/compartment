import type { EdgeSnapshotMetrics, EdgeSnapshotRestoreSource } from './edge-snapshot-metrics.service.types';

export function createEdgeSnapshotMetrics(): EdgeSnapshotMetrics {
  return new InMemoryEdgeSnapshotMetrics();
}

class InMemoryEdgeSnapshotMetrics implements EdgeSnapshotMetrics {
  #failClosedExpiryTotal: number = 0;
  #persistenceErrorsTotal: number = 0;
  #refreshErrorsTotal: number = 0;
  #persistedAtMs: number | null = null;
  #restoreSource: EdgeSnapshotRestoreSource | null = null;

  recordFailClosedExpiry(): void {
    this.#failClosedExpiryTotal += 1;
  }

  recordPersistenceError(): void {
    this.#persistenceErrorsTotal += 1;
  }

  recordRefreshError(): void {
    this.#refreshErrorsTotal += 1;
  }

  recordRestore(source: EdgeSnapshotRestoreSource, persistedAt?: string): void {
    this.#restoreSource = source;
    this.#persistedAtMs = persistedAt === undefined ? Date.now() : Date.parse(persistedAt);
  }

  render(now: Date = new Date()): string {
    const age: number = this.#persistedAtMs === null ? 0 : Math.max(0, (now.getTime() - this.#persistedAtMs) / 1_000);
    const api: number = this.#restoreSource === 'api' ? 1 : 0;
    const disk: number = this.#restoreSource === 'disk' ? 1 : 0;
    return `# TYPE compartment_edge_snapshot_age_seconds gauge
compartment_edge_snapshot_age_seconds ${age.toString()}
# TYPE compartment_edge_snapshot_restore_source gauge
compartment_edge_snapshot_restore_source{source="api"} ${api.toString()}
compartment_edge_snapshot_restore_source{source="disk"} ${disk.toString()}
# TYPE compartment_edge_snapshot_persistence_errors_total counter
compartment_edge_snapshot_persistence_errors_total ${this.#persistenceErrorsTotal.toString()}
# TYPE compartment_edge_snapshot_refresh_errors_total counter
compartment_edge_snapshot_refresh_errors_total ${this.#refreshErrorsTotal.toString()}
# TYPE compartment_edge_snapshot_fail_closed_expiry_total counter
compartment_edge_snapshot_fail_closed_expiry_total ${this.#failClosedExpiryTotal.toString()}
`;
  }
}
