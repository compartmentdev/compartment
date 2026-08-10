import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '../../test-support/src';
import { createApp, createSystemApp } from '../src/app';
import type { ApiApp } from '../src/app.types';
import { readApiConfig, type ApiConfig, type ApiPublicIngressConfig } from '../src/config';
import type { Database } from '../src/db/client';
import { clearApiRuntime, configureApiRuntime } from '../src/runtime/runtime';

interface ApiAppPair {
  app: ApiApp;
  systemApp: ApiApp;
}

interface ApiIntegrationTestContext {
  apiConfig: ApiConfig;
  databaseUrl: string;
  testTempDirectory: string;
}

export const testRuntimeControlToken: string = 'test-runtime-control-token';
export const publicIpv4Address: string = buildIpv4Address([8, 8, 8, 8]);
export const alternatePublicIpv4Address: string = buildIpv4Address([8, 8, 4, 4]);
export const mismatchedPublicIpv4Address: string = buildIpv4Address([1, 1, 1, 1]);
export const publicIpv6Address: string = buildIpv6Address(['2606', '4700', '4700', '0', '0', '0', '0', '1111']);

export function createManagedPublicIngressConfig(): ApiPublicIngressConfig {
  return { targets: [{ type: 'A', value: publicIpv4Address }] };
}

export function createEmptyPublicIngressConfig(): ApiPublicIngressConfig {
  return { targets: [] };
}

export function configureApiRuntimeWithPublicIngress(
  config: ApiConfig,
  db: Database,
  publicIngressConfig: ApiPublicIngressConfig = createEmptyPublicIngressConfig(),
): void {
  process.env.COMPARTMENT_INGRESS_TARGETS_JSON = JSON.stringify(publicIngressConfig.targets);
  configureApiRuntime({ config, db });
}

export function createApiIntegrationTestContext(databaseName: string, runtimeSlug: string): ApiIntegrationTestContext {
  const { testDatabaseUrl } = readDatabaseTestMode();
  const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, databaseName);
  const testTempDirectory: string = resolve(tmpdir(), `compartment-${runtimeSlug}-temp`);

  process.env.COMPARTMENT_DATABASE_URL = databaseUrl;
  process.env.COMPARTMENT_SESSION_SECRET = process.env.COMPARTMENT_SESSION_SECRET ?? 'test-secret';
  process.env.COMPARTMENT_ENV = 'dev';
  process.env.COMPARTMENT_INSTALL_TOKEN = 'test-install-token';
  process.env.COMPARTMENT_BASE_DOMAIN = 'localhost';
  process.env.COMPARTMENT_TLS_MODE = 'internal';
  process.env.COMPARTMENT_PUBLIC_PROTOCOL = 'http';
  process.env.COMPARTMENT_PUBLIC_HTTP_PORT = '80';
  process.env.COMPARTMENT_PUBLIC_HTTPS_PORT = '443';
  process.env.COMPARTMENT_INGRESS_TARGETS_JSON = '[]';
  process.env.COMPARTMENT_POSTGRES_PASSWORD = 'postgres';
  process.env.COMPARTMENT_EDGE_TOKEN = 'test-edge-token';
  process.env.COMPARTMENT_SYSTEM_API_SOCKET = `/tmp/compartment/${runtimeSlug}/system-api.sock`;
  process.env.COMPARTMENT_SYSTEM_TOKEN = 'test-system-token';
  process.env.COMPARTMENT_THROTTLE_AUTH_LOGIN_ROUTE_MAX_REQUESTS = '30';
  process.env.COMPARTMENT_THROTTLE_AUTH_LOGIN_ROUTE_WINDOW = '1m';
  process.env.COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_MAX_FAILURES = '20';
  process.env.COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_WINDOW = '5m';
  process.env.COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_BLOCK = '15m';
  process.env.COMPARTMENT_THROTTLE_AUTH_LOGIN_ACCOUNT_MAX_FAILURES = '10';
  process.env.COMPARTMENT_THROTTLE_AUTH_LOGIN_ACCOUNT_WINDOW = '10m';
  process.env.COMPARTMENT_THROTTLE_AUTH_LOGIN_ACCOUNT_BLOCK = '30m';
  process.env.COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_ACCOUNT_MAX_FAILURES = '5';
  process.env.COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_ACCOUNT_WINDOW = '1m';
  process.env.COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_ACCOUNT_BLOCK = '10m';
  process.env.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_ROUTE_MAX_REQUESTS = '10';
  process.env.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_ROUTE_WINDOW = '1m';
  process.env.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_MAX_FAILURES = '15';
  process.env.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_WINDOW = '10m';
  process.env.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_BLOCK = '30m';
  process.env.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SUBJECT_MAX_FAILURES = '5';
  process.env.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SUBJECT_WINDOW = '30m';
  process.env.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SUBJECT_BLOCK = '60m';
  process.env.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_SUBJECT_MAX_FAILURES = '3';
  process.env.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_SUBJECT_WINDOW = '10m';
  process.env.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_SUBJECT_BLOCK = '30m';
  process.env.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_ROUTE_MAX_REQUESTS = '10';
  process.env.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_ROUTE_WINDOW = '1m';
  process.env.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_MAX_FAILURES = '15';
  process.env.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_WINDOW = '10m';
  process.env.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_BLOCK = '30m';
  process.env.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SUBJECT_MAX_FAILURES = '5';
  process.env.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SUBJECT_WINDOW = '30m';
  process.env.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SUBJECT_BLOCK = '60m';
  process.env.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_SUBJECT_MAX_FAILURES = '3';
  process.env.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_SUBJECT_WINDOW = '10m';
  process.env.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_SUBJECT_BLOCK = '30m';
  process.env.COMPARTMENT_VARIABLES_MASTER_KEY = process.env.COMPARTMENT_VARIABLES_MASTER_KEY ?? '11'.repeat(32);
  process.env.COMPARTMENT_RUNTIME_CONTROL_TOKEN = testRuntimeControlToken;
  process.env.COMPARTMENT_SIGNUP_ENABLED = 'false';

  return {
    apiConfig: readApiConfig(),
    databaseUrl,
    testTempDirectory,
  };
}

export async function resetApiIntegrationTempDirectory(testTempDirectory: string): Promise<void> {
  await rm(testTempDirectory, { force: true, recursive: true });
  await mkdir(testTempDirectory, { recursive: true });
}

export async function cleanupApiIntegrationTempDirectory(testTempDirectory: string): Promise<void> {
  await rm(testTempDirectory, { force: true, recursive: true });
}

export async function createApiIntegrationApps(config: ApiConfig, db: Database, pool: Pool): Promise<ApiAppPair> {
  try {
    return {
      app: createApp({ closePool: false, config, configureRuntime: false, db, pool }),
      systemApp: createSystemApp({
        closePool: false,
        config,
        configureRuntime: false,
        db,
        pool,
      }),
    };
  } catch (error) {
    await pool.end();
    throw error;
  }
}

function buildIpv4Address(octets: readonly [number, number, number, number]): string {
  return octets.join('.');
}

function buildIpv6Address(segments: readonly [string, string, string, string, string, string, string, string]): string {
  return segments.join(':');
}

export async function cleanupApiIntegrationRuntime(app: ApiApp, systemApp: ApiApp, pool: Pool): Promise<void> {
  clearApiRuntime();
  await Promise.allSettled([app.close(), systemApp.close()]);
  await pool.end();
}
