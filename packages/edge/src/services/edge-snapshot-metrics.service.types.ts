import type { Registry } from '@compartment/utils';

export type EdgeSnapshotRestoreSource = 'api' | 'disk';

export interface EdgeSnapshotMetrics {
  registry: Registry;
  recordFailClosedExpiry(): void;
  recordPersistenceError(): void;
  recordRefreshError(): void;
  recordRestore(source: EdgeSnapshotRestoreSource, persistedAt?: string): void;
}
