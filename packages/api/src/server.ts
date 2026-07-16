import type { Pool } from 'pg';
import { createApp, createSystemApp } from './app';
import { readApiConfig, type ApiConfig } from './config';
import { createDatabase, createDatabasePool, type Database } from './db/client';
import type { ApiApp } from './app.types';
import { startApiJobs } from './jobs/api-jobs';
import type { ApiJobsRuntime } from './jobs/api-jobs.types';
import { clearApiRuntime, configureApiRuntime } from './runtime/runtime';
import { prepareSystemApiSocketPath, restrictSystemApiSocketPathPermissions } from './system-api-socket-path';

type ShutdownSignal = 'SIGINT' | 'SIGTERM';

interface SharedServerRuntime {
  app: ApiApp;
  db: Database;
  pool: Pool;
  resourceOperationPool: Pool;
  systemApp: ApiApp;
}

interface RunningSharedServerRuntime extends SharedServerRuntime {
  jobs: ApiJobsRuntime;
}

interface StartupSharedServerRuntime extends SharedServerRuntime {
  jobs: ApiJobsRuntime | null;
}

const shutdownSignals: ShutdownSignal[] = ['SIGINT', 'SIGTERM'];
let isShuttingDown: boolean = false;

async function main(): Promise<void> {
  const config: ApiConfig = readApiConfig();
  const pool: Pool = createDatabasePool(config.databaseUrl);
  const resourceOperationPool: Pool = createDatabasePool(config.databaseUrl);
  const runtime: SharedServerRuntime = createSharedServerRuntime(config, pool, resourceOperationPool);
  let jobs: ApiJobsRuntime | null = null;

  try {
    jobs = await startSharedServerRuntime(config, runtime);
  } catch (error) {
    await closeStartupSharedServerRuntime({ ...runtime, jobs });
    throw error;
  }

  registerShutdownHandlers({ ...runtime, jobs });
}

function createSharedServerRuntime(config: ApiConfig, pool: Pool, resourceOperationPool: Pool): SharedServerRuntime {
  const db: Database = createDatabase(pool, resourceOperationPool);
  const app: ApiApp = createApp({
    closePool: false,
    config,
    db,
    pool,
  });
  const systemApp: ApiApp = createSystemApp({
    closePool: false,
    config,
    configureRuntime: false,
    db,
    pool,
  });
  return { app, db, pool, resourceOperationPool, systemApp };
}

async function startSharedServerRuntime(config: ApiConfig, runtime: SharedServerRuntime): Promise<ApiJobsRuntime> {
  prepareSystemApiSocketPath(config.systemApiSocketPath);
  await runtime.app.listen({
    host: config.bindHost,
    port: config.port,
  });
  await runtime.systemApp.listen({
    path: config.systemApiSocketPath,
  });
  restrictSystemApiSocketPathPermissions(config.systemApiSocketPath);
  configureSharedApiRuntime(config, runtime.db);

  const jobs: ApiJobsRuntime = await startApiJobs({
    config,
    logger: runtime.app.log,
  });
  return jobs;
}

function configureSharedApiRuntime(config: ApiConfig, db: Database): void {
  configureApiRuntime({ config, db });
}

if (require.main === module) {
  void main();
}

function registerShutdownHandlers(runtime: RunningSharedServerRuntime): void {
  for (const signal of shutdownSignals) {
    process.once(signal, (): void => {
      void closeRunningSharedServerRuntime(runtime);
    });
  }
}

async function closeRunningSharedServerRuntime({
  app,
  jobs,
  pool,
  resourceOperationPool,
  systemApp,
}: RunningSharedServerRuntime): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  const closeResults: PromiseSettledResult<void>[] = await Promise.allSettled([
    jobs.stop(),
    app.close(),
    systemApp.close(),
  ]);
  const closeFailure: PromiseRejectedResult | null = findRejectedResult(closeResults);
  const cleanupFailure: Error | null = await closeSharedRuntimeState([pool, resourceOperationPool]);
  reportRuntimeCloseFailures(app, closeFailure, cleanupFailure);
  process.exit(closeFailure === null && cleanupFailure === null ? 0 : 1);
}

function reportRuntimeCloseFailures(
  app: ApiApp,
  closeFailure: PromiseRejectedResult | null,
  cleanupFailure: Error | null,
): void {
  if (closeFailure !== null) {
    app.log.error({ err: closeFailure.reason }, 'Failed to close API server listeners cleanly');
  }
  if (cleanupFailure !== null) {
    app.log.error({ err: cleanupFailure }, 'Failed to close shared API runtime cleanly');
  }
}

async function closeStartupSharedServerRuntime({
  app,
  jobs,
  pool,
  resourceOperationPool,
  systemApp,
}: StartupSharedServerRuntime): Promise<void> {
  const closeTasks: Promise<void>[] = [app.close(), systemApp.close()];
  if (jobs !== null) {
    closeTasks.unshift(jobs.stop());
  }

  await Promise.allSettled(closeTasks);
  await closeSharedRuntimeState([pool, resourceOperationPool]);
}

function findRejectedResult(results: PromiseSettledResult<void>[]): PromiseRejectedResult | null {
  for (const result of results) {
    if (result.status === 'rejected') {
      return result;
    }
  }

  return null;
}

async function closeSharedRuntimeState(pools: Pool[]): Promise<Error | null> {
  try {
    clearApiRuntime();
    await Promise.all(pools.map(async (pool: Pool): Promise<void> => await pool.end()));
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}
