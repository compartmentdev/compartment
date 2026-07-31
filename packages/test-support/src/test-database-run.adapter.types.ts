export interface TestDatabaseMaintenanceSession {
  acquireLock(lockName: string): Promise<void>;
  close(): Promise<void>;
  dropDatabase(databaseName: string): Promise<void>;
  listDatabaseNames(prefix: string): Promise<string[]>;
  releaseLock(lockName: string): Promise<void>;
  tryAcquireLock(lockName: string): Promise<boolean>;
}
