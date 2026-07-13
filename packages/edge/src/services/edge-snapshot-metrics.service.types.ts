export type EdgeSnapshotRestoreSource = 'api' | 'disk';

export interface EdgeSnapshotMetrics {
  recordFailClosedExpiry(): void;
  recordPersistenceError(): void;
  recordRefreshError(): void;
  recordRestore(source: EdgeSnapshotRestoreSource, persistedAt?: string): void;
  render(now?: Date): string;
}
