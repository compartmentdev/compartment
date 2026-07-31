import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { ensureDatabaseExists, readDatabaseTestMode } from '../src';
import { readDatabaseName } from '../src/database-url';
import { deriveTestDatabaseUrlForRun } from '../src/database-url-variants';
import { cleanupStaleTestDatabaseRuns, startTestDatabaseRun } from '../src/test-database-run';
import { openTestDatabaseMaintenanceSession } from '../src/test-database-run.adapter';
import type { TestDatabaseMaintenanceSession } from '../src/test-database-run.adapter.types';
import type { TestDatabaseRun } from '../src/test-database-run.types';

const { testDatabaseUrl } = readDatabaseTestMode();
const testDatabaseLifecycleTimeoutMilliseconds: number = 30_000;

describe.sequential('test database run lifecycle', (): void => {
  it(
    'preserves an active run while removing an unlocked orphan',
    async (): Promise<void> => {
      const activeRun: TestDatabaseRun = await startTestDatabaseRun(testDatabaseUrl);
      const activeDatabaseUrl: string = deriveTestDatabaseUrlForRun(testDatabaseUrl, 'active_run', activeRun.runId);
      const orphanDatabaseUrl: string = deriveTestDatabaseUrlForRun(testDatabaseUrl, 'orphan_run', createRunId());

      try {
        await ensureDatabaseExists(activeDatabaseUrl);
        await ensureDatabaseExists(orphanDatabaseUrl);

        await cleanupStaleTestDatabaseRuns(testDatabaseUrl);

        await expectDatabaseExists(activeDatabaseUrl, true);
        await expectDatabaseExists(orphanDatabaseUrl, false);
      } finally {
        await activeRun.stop();
      }
    },
    testDatabaseLifecycleTimeoutMilliseconds,
  );

  it(
    'serializes concurrent cleaners for the same orphaned run',
    async (): Promise<void> => {
      const orphanRunId: string = createRunId();
      const firstDatabaseUrl: string = deriveTestDatabaseUrlForRun(testDatabaseUrl, 'concurrent_first', orphanRunId);
      const secondDatabaseUrl: string = deriveTestDatabaseUrlForRun(testDatabaseUrl, 'concurrent_second', orphanRunId);
      try {
        await ensureDatabaseExists(firstDatabaseUrl);
        await ensureDatabaseExists(secondDatabaseUrl);

        await Promise.all([
          cleanupStaleTestDatabaseRuns(testDatabaseUrl),
          cleanupStaleTestDatabaseRuns(testDatabaseUrl),
        ]);

        await expectDatabaseExists(firstDatabaseUrl, false);
        await expectDatabaseExists(secondDatabaseUrl, false);
      } finally {
        await cleanupStaleTestDatabaseRuns(testDatabaseUrl);
      }
    },
    testDatabaseLifecycleTimeoutMilliseconds,
  );

  it(
    'drops every database owned by the exact run during teardown',
    async (): Promise<void> => {
      const testDatabaseRun: TestDatabaseRun = await startTestDatabaseRun(testDatabaseUrl);
      const firstDatabaseUrl: string = deriveTestDatabaseUrlForRun(
        testDatabaseUrl,
        'teardown_first',
        testDatabaseRun.runId,
      );
      const secondDatabaseUrl: string = deriveTestDatabaseUrlForRun(
        testDatabaseUrl,
        'teardown_second',
        testDatabaseRun.runId,
      );
      let lingeringClient: Client | undefined;

      try {
        await ensureDatabaseExists(firstDatabaseUrl);
        await ensureDatabaseExists(secondDatabaseUrl);
        lingeringClient = new Client({ connectionString: firstDatabaseUrl });
        lingeringClient.on('error', ignoreForcedDisconnect);
        await lingeringClient.connect();
        await testDatabaseRun.stop();
      } finally {
        if (lingeringClient !== undefined) {
          await closeClientAfterForcedDisconnect(lingeringClient);
        }
        await testDatabaseRun.stop();
      }

      await expectDatabaseExists(firstDatabaseUrl, false);
      await expectDatabaseExists(secondDatabaseUrl, false);
    },
    testDatabaseLifecycleTimeoutMilliseconds,
  );
});

async function expectDatabaseExists(databaseUrl: string, expected: boolean): Promise<void> {
  const databaseName: string = readDatabaseName(databaseUrl);
  const session: TestDatabaseMaintenanceSession = await openTestDatabaseMaintenanceSession(testDatabaseUrl);
  try {
    const databaseNames: string[] = await session.listDatabaseNames(databaseName);
    expect(databaseNames.includes(databaseName)).toBe(expected);
  } finally {
    await session.close();
  }
}

function createRunId(): string {
  return randomBytes(6).toString('hex');
}

function ignoreForcedDisconnect(error: Error): void {
  void error;
}

async function closeClientAfterForcedDisconnect(client: Client): Promise<void> {
  try {
    await client.end();
  } catch {
    return;
  }
}
