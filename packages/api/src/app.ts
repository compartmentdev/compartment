import Fastify from 'fastify';
import pino from 'pino';
import type { Pool } from 'pg';
import multipart from '@fastify/multipart';

import { readApiConfig, type ApiConfig } from './config';
import type { ApiApp, CreateAppOptions } from './app.types';
import { createDatabase, createDatabasePool, type Database } from './db/client';
import { registerApiErrorHandler } from './http/error-handler';
import { registerUrlEncodedFormBodyParser } from './http/form-body';
import { registerJsonBodyParsers } from './http/json-body';
import { defaultRequestReceiveTimeoutMs } from './http/request-timeout';
import { registerApiRequestLogging } from './http/request-logging';
import { registerApiRateLimit } from './http/rate-limit';
import { registerApiRoutes } from './routes/register-routes';
import { registerSystemRoutes } from './routes/system/register-system-routes';
import { clearApiRuntime, configureApiRuntime } from './runtime/runtime';
import { closeAuditEventFileSink, initializeAuditEventFileSink } from './services/audit-event-file-sink.service';
import {
  ensurePrivateRuntimeStorageRootDirectorySync,
  repairPrivateRuntimeStoragePermissions,
} from './services/private-runtime-storage-permissions.service';

type AppRouteRegistrar = (app: ApiApp, config: ApiConfig) => void;

interface RuntimeAppInput {
  config: ApiConfig;
  configureRuntime: boolean;
  db: Database;
}

export function createApp(options: CreateAppOptions = {}): ApiApp {
  return createConfiguredApp(options, registerApiRoutes);
}

export function createSystemApp(options: CreateAppOptions = {}): ApiApp {
  return createConfiguredApp(options, registerSystemRoutes);
}

function createConfiguredApp(
  {
    closePool = true,
    config = readApiConfig(),
    configureRuntime = true,
    db,
    pool = createDatabasePool(config.databaseUrl),
  }: CreateAppOptions,
  registerRoutes: AppRouteRegistrar,
): ApiApp {
  const app: ApiApp = createRuntimeApp({ config, configureRuntime, db: db ?? createDatabase(pool) });
  registerApiErrorHandler(app);
  app.after((): void => {
    registerRoutes(app, config);
  });
  registerAppCloseHook(app, pool, closePool);
  return app;
}

function createRuntimeApp(input: RuntimeAppInput): ApiApp {
  const app: ApiApp = createApiApp(input.config.logLevel);
  app.decorateRequest('actor');
  app.decorateRequest('authTransport');
  app.decorateRequest('currentOrganization');
  app.decorateRequest('rawBody');
  registerJsonBodyParsers(app);
  registerUrlEncodedFormBodyParser(app);
  initializeRuntimeAppState(app, input);
  registerApiRateLimit(app);
  return app;
}

function initializeRuntimeAppState(app: ApiApp, input: RuntimeAppInput): void {
  ensureRuntimeDirectories(input.config);
  const runtimeStorageRepairTask: Promise<void> = repairRuntimeStoragePermissions(input.config);
  runtimeStorageRepairTask.catch((): void => undefined);
  registerRuntimeStorageRepairHook(app, runtimeStorageRepairTask);
  if (input.configureRuntime) {
    initializeAuditEventFileSink({ config: input.config, logger: app.log });
    configureApiRuntime({ config: input.config, db: input.db });
  }
}

function createApiApp(logLevel: string): ApiApp {
  const app: ApiApp = Fastify({
    disableRequestLogging: true,
    loggerInstance: createApiLogger(logLevel),
    requestTimeout: defaultRequestReceiveTimeoutMs,
    trustProxy: 1,
  });

  registerApiRequestLogging(app);
  app.register(multipart);

  return app;
}

function createApiLogger(logLevel: string): pino.Logger<never, boolean> {
  return pino({
    level: logLevel,
    base: {
      service: 'api',
    },
  });
}

function ensureRuntimeDirectories(config: ApiConfig): void {
  ensurePrivateRuntimeStorageRootDirectorySync(config.sourceArchiveDirectory);
  ensurePrivateRuntimeStorageRootDirectorySync(config.resourceBackupDirectory);
}

async function repairRuntimeStoragePermissions(config: ApiConfig): Promise<void> {
  await repairPrivateRuntimeStoragePermissions(config.sourceArchiveDirectory);
  await repairPrivateRuntimeStoragePermissions(config.resourceBackupDirectory);
}

function registerRuntimeStorageRepairHook(app: ApiApp, runtimeStorageRepairTask: Promise<void>): void {
  app.addHook('onReady', async (): Promise<void> => {
    await runtimeStorageRepairTask;
  });
}

function registerAppCloseHook(app: ApiApp, pool: Pool, closePool: boolean): void {
  app.addHook('onClose', async (): Promise<void> => {
    await closeAuditEventFileSink();
    if (closePool) {
      clearApiRuntime();
      await pool.end();
    }
  });
}
