import { Counter, Gauge, createPrometheusRegistry, type Registry } from '@compartment/utils/metrics';
import type { EdgeSnapshotMetrics, EdgeSnapshotRestoreSource } from './edge-snapshot-metrics.service.types';

export function createEdgeSnapshotMetrics(): EdgeSnapshotMetrics {
  return new PrometheusEdgeSnapshotMetrics();
}

class PrometheusEdgeSnapshotMetrics implements EdgeSnapshotMetrics {
  readonly registry: Registry = createPrometheusRegistry('edge');
  readonly #age: Gauge;
  readonly #failClosedExpiry: Counter;
  readonly #persistenceErrors: Counter;
  readonly #refreshErrors: Counter;
  readonly #restoreSource: Gauge<'source'>;
  #persistedAtMs: number | null = null;

  constructor() {
    this.#age = new Gauge({
      collect: (): void => this.#age.set(this.#snapshotAgeSeconds()),
      help: 'Age in seconds of the active Edge access snapshot.',
      name: 'compartment_edge_snapshot_age_seconds',
      registers: [this.registry],
    });
    this.#restoreSource = new Gauge({
      help: 'Source used to restore the active Edge access snapshot.',
      labelNames: ['source'],
      name: 'compartment_edge_snapshot_restore_source',
      registers: [this.registry],
    });
    this.#persistenceErrors = new Counter({
      help: 'Edge snapshot persistence failures.',
      name: 'compartment_edge_snapshot_persistence_errors_total',
      registers: [this.registry],
    });
    this.#refreshErrors = new Counter({
      help: 'Edge snapshot refresh failures.',
      name: 'compartment_edge_snapshot_refresh_errors_total',
      registers: [this.registry],
    });
    this.#failClosedExpiry = new Counter({
      help: 'Edge requests rejected after the snapshot exceeded its fail-closed age.',
      name: 'compartment_edge_snapshot_fail_closed_expiry_total',
      registers: [this.registry],
    });
    this.#restoreSource.set({ source: 'api' }, 0);
    this.#restoreSource.set({ source: 'disk' }, 0);
  }

  recordFailClosedExpiry(): void {
    this.#failClosedExpiry.inc();
  }

  recordPersistenceError(): void {
    this.#persistenceErrors.inc();
  }

  recordRefreshError(): void {
    this.#refreshErrors.inc();
  }

  recordRestore(source: EdgeSnapshotRestoreSource, persistedAt?: string): void {
    const persistedAtMs: number = persistedAt === undefined ? Date.now() : Date.parse(persistedAt);
    if (!Number.isFinite(persistedAtMs)) {
      throw new Error('Invalid Edge snapshot persistedAt timestamp.');
    }
    this.#restoreSource.set({ source: 'api' }, source === 'api' ? 1 : 0);
    this.#restoreSource.set({ source: 'disk' }, source === 'disk' ? 1 : 0);
    this.#persistedAtMs = persistedAtMs;
  }

  #snapshotAgeSeconds(now: Date = new Date()): number {
    return this.#persistedAtMs === null ? 0 : Math.max(0, (now.getTime() - this.#persistedAtMs) / 1_000);
  }
}
