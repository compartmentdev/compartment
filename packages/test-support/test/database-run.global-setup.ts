import { readDatabaseTestMode } from '../src/database-test-mode';
import { testDatabaseRunIdEnvironmentVariableName } from '../src/database-url-variants';
import { startTestDatabaseRun } from '../src/test-database-run';
import type { TestDatabaseRun } from '../src/test-database-run.types';

export async function setup(): Promise<() => Promise<void>> {
  const { testDatabaseUrl } = readDatabaseTestMode();
  const testDatabaseRun: TestDatabaseRun = await startTestDatabaseRun(testDatabaseUrl);
  process.env[testDatabaseRunIdEnvironmentVariableName] = testDatabaseRun.runId;

  return async (): Promise<void> => {
    delete process.env[testDatabaseRunIdEnvironmentVariableName];
    await testDatabaseRun.stop();
  };
}
