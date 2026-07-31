export interface TestDatabaseRun {
  runId: string;
  stop(): Promise<void>;
}
