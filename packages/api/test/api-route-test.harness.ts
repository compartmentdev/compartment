import type { JsonValue } from '@compartment/utils';
import type { LightMyRequestResponse } from 'fastify';
import { createApp } from '../src/app';
import type { ApiApp } from '../src/app.types';

interface ApiRouteTestEnvInput {
  baseDomain?: string | undefined;
  edgeToken?: string | undefined;
  logLevel?: string | undefined;
  publicHttpPort?: number | undefined;
  publicHttpsPort?: number | undefined;
  publicProtocol?: 'http' | 'https' | undefined;
  runtimeControlToken?: string | undefined;
  systemToken?: string | undefined;
  throttleAuthActivationRouteMaxRequests?: number | undefined;
  throttleAuthLoginRouteMaxRequests?: number | undefined;
  throttleAuthResetPasswordRouteMaxRequests?: number | undefined;
}

interface ApiRouteRequestInput {
  headers?: Record<string, string> | undefined;
  method: 'GET' | 'PATCH' | 'POST';
  payload?: string | Record<string, JsonValue> | undefined;
  query?: Record<string, string> | undefined;
  timeoutMs?: number | undefined;
  url: string;
}

interface ApiRouteJsonRequestInput extends ApiRouteRequestInput {
  payload?: Record<string, JsonValue> | undefined;
}

interface ApiRouteFormRequestInput extends Omit<ApiRouteRequestInput, 'payload'> {
  form: Record<string, string>;
}

interface ApiRouteInjectOptions {
  headers?: Record<string, string>;
  method: 'GET' | 'PATCH' | 'POST';
  payload?: string | Record<string, JsonValue>;
  query?: Record<string, string>;
  url: string;
}

export function applyApiRouteTestEnv({
  baseDomain = 'localhost',
  edgeToken = 'test-edge-token',
  logLevel = 'silent',
  publicHttpPort = 9080,
  publicHttpsPort = 9444,
  publicProtocol = 'http',
  runtimeControlToken = 'test-runtime-control-token',
  systemToken = 'test-system-token',
  throttleAuthActivationRouteMaxRequests = 10,
  throttleAuthLoginRouteMaxRequests = 30,
  throttleAuthResetPasswordRouteMaxRequests = 10,
}: ApiRouteTestEnvInput = {}): void {
  process.env.COMPARTMENT_EDGE_TOKEN = edgeToken;
  process.env.COMPARTMENT_LOG_LEVEL = logLevel;
  process.env.COMPARTMENT_CADDY_TLS_MODE = 'internal';
  process.env.COMPARTMENT_PUBLIC_HTTP_PORT = String(publicHttpPort);
  process.env.COMPARTMENT_PUBLIC_HTTPS_PORT = String(publicHttpsPort);
  process.env.COMPARTMENT_PUBLIC_PROTOCOL = publicProtocol;
  process.env.COMPARTMENT_AUDIT_RETENTION_DAYS = '90';
  process.env.COMPARTMENT_AUDIT_RETENTION_CLEANUP_BATCH_SIZE = '1000';
  process.env.COMPARTMENT_AUDIT_RETENTION_CLEANUP_CRON = '0 3 * * *';
  process.env.COMPARTMENT_AUDIT_RETENTION_CLEANUP_MAX_BATCHES = '100';
  process.env.COMPARTMENT_AUDIT_FILE_SINK_DIR = '/tmp/compartment-test-audit-logs';
  process.env.COMPARTMENT_AUDIT_FILE_SINK_ENABLED = 'false';
  process.env.COMPARTMENT_AUDIT_FILE_SINK_RETENTION_FILES = '30';
  process.env.COMPARTMENT_AUDIT_FILE_SINK_ROTATE_INTERVAL = '1d';
  process.env.COMPARTMENT_AUDIT_FILE_SINK_ROTATE_SIZE = '64M';
  process.env.COMPARTMENT_NODE_AGENT_SOCKET = '/tmp/compartment/test/node/agent.sock';
  process.env.COMPARTMENT_RUNTIME_CONTROL_TOKEN = runtimeControlToken;
  process.env.COMPARTMENT_SYSTEM_API_SOCKET = '/tmp/compartment/test/system-api.sock';
  process.env.COMPARTMENT_SYSTEM_TOKEN = systemToken;
  process.env.COMPARTMENT_TRUSTED_OUTBOUND_HOSTS = '';
  process.env.COMPARTMENT_THROTTLE_AUTH_LOGIN_ROUTE_MAX_REQUESTS = String(throttleAuthLoginRouteMaxRequests);
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
  process.env.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_ROUTE_MAX_REQUESTS = String(throttleAuthActivationRouteMaxRequests);
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
  process.env.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_ROUTE_MAX_REQUESTS = String(
    throttleAuthResetPasswordRouteMaxRequests,
  );
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
  process.env.COMPARTMENT_VARIABLES_MASTER_KEY = '11'.repeat(32);
  process.env.COMPARTMENT_BASE_DOMAIN = baseDomain;
}

export async function withApiRouteApp<TResult>(run: (app: ApiApp) => Promise<TResult>): Promise<TResult> {
  const app: ApiApp = createApp();

  try {
    return await run(app);
  } finally {
    await app.close();
  }
}

export async function injectJson(app: ApiApp, input: ApiRouteJsonRequestInput): Promise<LightMyRequestResponse> {
  return await injectApiRoute(app, {
    ...input,
    headers: {
      'content-type': 'application/json',
      ...input.headers,
    },
  });
}

export async function injectForm(app: ApiApp, input: ApiRouteFormRequestInput): Promise<LightMyRequestResponse> {
  return await injectApiRoute(app, {
    ...input,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...input.headers,
    },
    payload: new URLSearchParams(input.form).toString(),
  });
}

export async function injectApiRoute(app: ApiApp, input: ApiRouteRequestInput): Promise<LightMyRequestResponse> {
  const request: ApiRouteInjectOptions = {
    method: input.method,
    url: input.url,
  };
  if (input.headers !== undefined) {
    request.headers = input.headers;
  }
  if (input.payload !== undefined) {
    request.payload = input.payload;
  }
  if (input.query !== undefined) {
    request.query = input.query;
  }

  const responsePromise: Promise<LightMyRequestResponse> = app.inject(request);
  if (input.timeoutMs === undefined) {
    return await responsePromise;
  }

  return await Promise.race([
    responsePromise,
    new Promise<LightMyRequestResponse>(
      (_resolve: (value: LightMyRequestResponse) => void, reject: (reason?: Error) => void): void => {
        setTimeout((): void => {
          reject(new Error('Timed out waiting for API route response.'));
        }, input.timeoutMs);
      },
    ),
  ]);
}

export function expectJsonError(response: LightMyRequestResponse, statusCode: number, errorCode: string): void {
  if (response.statusCode !== statusCode) {
    throw new Error(`Expected status ${statusCode}, got ${response.statusCode}.`);
  }
  if (!response.body.includes(errorCode)) {
    throw new Error(`Expected response body to include ${errorCode}.`);
  }
}
