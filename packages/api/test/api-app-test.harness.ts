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
import { assertNoIntegrationNodeAgentHarnessErrors } from './api-node-agent.integration-harness';

interface ApiAppPair {
  app: ApiApp;
  systemApp: ApiApp;
}

interface ApiIntegrationTestContext {
  apiConfig: ApiConfig;
  databaseUrl: string;
  testCustomTlsDirectory: string;
}

export const publicIpv4Address: string = buildIpv4Address([8, 8, 8, 8]);
export const alternatePublicIpv4Address: string = buildIpv4Address([8, 8, 4, 4]);
export const mismatchedPublicIpv4Address: string = buildIpv4Address([1, 1, 1, 1]);
export const publicIpv6Address: string = buildIpv6Address(['2606', '4700', '4700', '0', '0', '0', '0', '1111']);

export function createManagedPublicIngressConfig(): ApiPublicIngressConfig {
  return {
    publicIngressIpv4: publicIpv4Address,
    publicIngressIpv6: null,
  };
}

export function createEmptyPublicIngressConfig(): ApiPublicIngressConfig {
  return {
    publicIngressIpv4: null,
    publicIngressIpv6: null,
  };
}

export function configureApiRuntimeWithPublicIngress(
  config: ApiConfig,
  db: Database,
  publicIngressConfig: ApiPublicIngressConfig = createEmptyPublicIngressConfig(),
): void {
  process.env.COMPARTMENT_PUBLIC_INGRESS_IPV4 = publicIngressConfig.publicIngressIpv4 ?? '';
  process.env.COMPARTMENT_PUBLIC_INGRESS_IPV6 = publicIngressConfig.publicIngressIpv6 ?? '';
  configureApiRuntime({ config, db });
}

export function createApiIntegrationTestContext(databaseName: string, runtimeSlug: string): ApiIntegrationTestContext {
  const { testDatabaseUrl } = readDatabaseTestMode();
  const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, databaseName);
  const testCustomTlsDirectory: string = resolve(tmpdir(), `compartment-${runtimeSlug}-tls`);

  process.env.COMPARTMENT_DATABASE_URL = databaseUrl;
  process.env.COMPARTMENT_SESSION_SECRET = process.env.COMPARTMENT_SESSION_SECRET ?? 'test-secret';
  process.env.COMPARTMENT_BASE_DOMAIN = 'localhost';
  process.env.COMPARTMENT_CADDY_TLS_MODE = 'internal';
  process.env.COMPARTMENT_CUSTOM_TLS_DIR = testCustomTlsDirectory;
  process.env.COMPARTMENT_PUBLIC_PROTOCOL = 'http';
  process.env.COMPARTMENT_PUBLIC_HTTP_PORT = '80';
  process.env.COMPARTMENT_PUBLIC_HTTPS_PORT = '443';
  process.env.COMPARTMENT_PUBLIC_INGRESS_IPV4 = '';
  process.env.COMPARTMENT_PUBLIC_INGRESS_IPV6 = '';
  process.env.COMPARTMENT_EDGE_TOKEN = 'test-edge-token';
  process.env.COMPARTMENT_NODE_AGENT_SOCKET = '/tmp/compartment/api-test/node/integration.sock';
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
  process.env.COMPARTMENT_RUNTIME_CONTROL_TOKEN = 'test-runtime-control-token';

  return {
    apiConfig: readApiConfig(),
    databaseUrl,
    testCustomTlsDirectory,
  };
}

export async function resetApiIntegrationTlsDirectory(testCustomTlsDirectory: string): Promise<void> {
  await rm(testCustomTlsDirectory, { force: true, recursive: true });
  await mkdir(testCustomTlsDirectory, { recursive: true });
}

export async function cleanupApiIntegrationTlsDirectory(testCustomTlsDirectory: string): Promise<void> {
  await rm(testCustomTlsDirectory, { force: true, recursive: true });
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
  try {
    assertNoIntegrationNodeAgentHarnessErrors();
  } finally {
    clearApiRuntime();
    await Promise.allSettled([app.close(), systemApp.close()]);
    await pool.end();
  }
}
