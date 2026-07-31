import { randomBytes } from 'node:crypto';
import { readDatabaseName } from './database-url';
import { createTestDatabaseRunPrefix, readTestDatabaseRunId } from './database-url-variants';
import { openTestDatabaseMaintenanceSession } from './test-database-run.adapter';
import type { TestDatabaseMaintenanceSession } from './test-database-run.adapter.types';
import type { TestDatabaseRun } from './test-database-run.types';

const advisoryLockNamespace: string = 'compartment:test-database';

class ManagedTestDatabaseRun implements TestDatabaseRun {
  readonly #baseDatabaseUrl: string;
  readonly #leaseSession: TestDatabaseMaintenanceSession;
  public readonly runId: string;
  #stopped: boolean = false;

  public constructor(baseDatabaseUrl: string, runId: string, leaseSession: TestDatabaseMaintenanceSession) {
    this.#baseDatabaseUrl = baseDatabaseUrl;
    this.runId = runId;
    this.#leaseSession = leaseSession;
  }

  public async stop(): Promise<void> {
    if (this.#stopped) {
      return;
    }
    this.#stopped = true;
    try {
      await cleanupTestDatabaseRun(this.#baseDatabaseUrl, this.runId);
    } finally {
      await this.#leaseSession.close();
    }
  }
}

export async function startTestDatabaseRun(baseDatabaseUrl: string): Promise<TestDatabaseRun> {
  const baseDatabaseName: string = readDatabaseName(baseDatabaseUrl);
  const runId: string = randomBytes(6).toString('hex');
  const leaseSession: TestDatabaseMaintenanceSession = await openTestDatabaseMaintenanceSession(baseDatabaseUrl);

  await initializeTestDatabaseRun(baseDatabaseUrl, baseDatabaseName, runId, leaseSession);
  return new ManagedTestDatabaseRun(baseDatabaseUrl, runId, leaseSession);
}

async function initializeTestDatabaseRun(
  baseDatabaseUrl: string,
  baseDatabaseName: string,
  runId: string,
  leaseSession: TestDatabaseMaintenanceSession,
): Promise<void> {
  try {
    await leaseSession.acquireLock(createRunLeaseLockName(baseDatabaseName, runId));
    await cleanupStaleTestDatabaseRuns(baseDatabaseUrl);
  } catch (error) {
    await leaseSession.close();
    throw error;
  }
}

export async function cleanupStaleTestDatabaseRuns(baseDatabaseUrl: string): Promise<void> {
  const baseDatabaseName: string = readDatabaseName(baseDatabaseUrl);
  const session: TestDatabaseMaintenanceSession = await openTestDatabaseMaintenanceSession(baseDatabaseUrl);
  const cleanupLockName: string = createCleanupLockName(baseDatabaseName);

  try {
    await withSessionLock(session, cleanupLockName, async (): Promise<void> => {
      await cleanupStaleTestDatabaseRunsWithSession(session, baseDatabaseName);
    });
  } finally {
    await session.close();
  }
}

async function cleanupStaleTestDatabaseRunsWithSession(
  session: TestDatabaseMaintenanceSession,
  baseDatabaseName: string,
): Promise<void> {
  const databaseNames: string[] = await session.listDatabaseNames(createTestDatabaseNamespacePrefix(baseDatabaseName));
  const databasesByRunId: Map<string, string[]> = groupDatabaseNamesByRunId(baseDatabaseName, databaseNames);

  for (const [runId, runDatabaseNames] of databasesByRunId) {
    await cleanupStaleTestDatabaseRun(session, baseDatabaseName, runId, runDatabaseNames);
  }
}

async function cleanupStaleTestDatabaseRun(
  session: TestDatabaseMaintenanceSession,
  baseDatabaseName: string,
  runId: string,
  databaseNames: string[],
): Promise<void> {
  const leaseLockName: string = createRunLeaseLockName(baseDatabaseName, runId);
  if (!(await session.tryAcquireLock(leaseLockName))) {
    return;
  }

  try {
    await dropDatabases(session, databaseNames);
  } finally {
    await session.releaseLock(leaseLockName);
  }
}

async function cleanupTestDatabaseRun(baseDatabaseUrl: string, runId: string): Promise<void> {
  const baseDatabaseName: string = readDatabaseName(baseDatabaseUrl);
  const session: TestDatabaseMaintenanceSession = await openTestDatabaseMaintenanceSession(baseDatabaseUrl);
  const cleanupLockName: string = createCleanupLockName(baseDatabaseName);

  try {
    await withSessionLock(session, cleanupLockName, async (): Promise<void> => {
      const prefix: string = createTestDatabaseRunPrefix(baseDatabaseName, runId);
      const databaseNames: string[] = await session.listDatabaseNames(prefix);
      await dropDatabases(session, databaseNames);
    });
  } finally {
    await session.close();
  }
}

async function withSessionLock(
  session: TestDatabaseMaintenanceSession,
  lockName: string,
  operation: () => Promise<void>,
): Promise<void> {
  await session.acquireLock(lockName);
  try {
    await operation();
  } finally {
    await session.releaseLock(lockName);
  }
}

async function dropDatabases(session: TestDatabaseMaintenanceSession, databaseNames: string[]): Promise<void> {
  const errors: Error[] = [];
  for (const databaseName of databaseNames) {
    try {
      await session.dropDatabase(databaseName);
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error('Unknown test database cleanup error.'));
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'Failed to clean up one or more test databases.');
  }
}

function groupDatabaseNamesByRunId(baseDatabaseName: string, databaseNames: string[]): Map<string, string[]> {
  const databasesByRunId: Map<string, string[]> = new Map<string, string[]>();
  for (const databaseName of databaseNames) {
    const runId: string | null = readTestDatabaseRunId(baseDatabaseName, databaseName);
    if (runId === null) {
      continue;
    }
    const runDatabaseNames: string[] = databasesByRunId.get(runId) ?? [];
    runDatabaseNames.push(databaseName);
    databasesByRunId.set(runId, runDatabaseNames);
  }
  return databasesByRunId;
}

function createTestDatabaseNamespacePrefix(baseDatabaseName: string): string {
  return createTestDatabaseRunPrefix(baseDatabaseName, '000000000000').slice(0, -13);
}

function createCleanupLockName(baseDatabaseName: string): string {
  return `${advisoryLockNamespace}:cleanup:${baseDatabaseName}`;
}

function createRunLeaseLockName(baseDatabaseName: string, runId: string): string {
  return `${advisoryLockNamespace}:run:${baseDatabaseName}:${runId}`;
}
