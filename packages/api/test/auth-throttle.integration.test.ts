import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';
import {
  errorResponseSchema,
  inviteUserResponseSchema,
  type InstallResponse,
  type InviteUserResponse,
} from '@compartment/contracts';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deriveTestDatabaseUrl,
  ensureDatabaseExists,
  readDatabaseTestMode,
  resetDatabase,
  runCompartmentApiMigrations as runApiMigrations,
} from '../../test-support/src';
import { createApp } from '../src/app';
import type { ApiApp } from '../src/app.types';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import { throttleBuckets } from '../src/db/schema';
import {
  authApiActivatePathname,
  authApiLoginPathname,
  authApiResetPasswordPathname,
} from '../src/routes/auth/auth-api-paths';
import { issuePasswordReset } from '../src/services/password-reset-issue.service';
import {
  buildOrganizationAuthorizationHeaders,
  installCompartment,
  requireQueryParam,
} from './api-integration.harness';

interface AppAccessEdgeServiceModule {
  invalidateEdgeAppAccessSessions: () => Promise<void>;
  synchronizeEdgeAppAccessState: () => Promise<void>;
}

interface ThrottleBucketRecord {
  attemptCount: number;
  bucketKind: string;
}

vi.mock(
  '../src/services/app-access-edge.service',
  (): AppAccessEdgeServiceModule => ({
    invalidateEdgeAppAccessSessions: async (): Promise<void> => await Promise.resolve(),
    synchronizeEdgeAppAccessState: async (): Promise<void> => await Promise.resolve(),
  }),
);

const { testDatabaseUrl } = readDatabaseTestMode();
const authThrottleDatabaseUrl: string = deriveTestDatabaseUrl(testDatabaseUrl, 'api_auth_throttle');
const apiConfig: ApiConfig = {
  bindHost: '127.0.0.1',
  baseDomain: 'localhost',
  caddyTlsMode: 'internal',
  controlPlaneHost: 'console.localhost',
  customTlsDirectory: '/etc/compartment/tls',
  databaseUrl: authThrottleDatabaseUrl,
  edgeToken: 'test-edge-token',
  edgeUrl: 'http://127.0.0.1:9081',
  logLevel: 'silent',
  port: 9443,
  publicHttpPort: 80,
  publicHttpsPort: 443,
  publicProtocol: 'http',
  auditRetentionDays: 90,
  auditRetentionCleanupBatchSize: 1000,
  auditRetentionCleanupCron: '0 3 * * *',
  auditRetentionCleanupMaxBatches: 100,
  auditFileSink: defaultAuditFileSinkConfig,
  rollbackRetentionLimit: null,
  runtimeDefaultUpstreamHost: '127.0.0.1',
  sessionSecret: 'test-secret',
  sessionTtlMs: 604_800_000,
  sourceArchiveDirectory: join(tmpdir(), 'compartment-api-auth-throttle-source-archives'),
  resourceBackupDirectory: '/tmp/compartment-test-resource-backups',
  sourceArchiveMaxBytes: 104_857_600,
  nodeAgentSocketPath: '/tmp/compartment/api-test/node/integration.sock',
  systemApiSocketPath: '/tmp/compartment/compartment-auth-throttle-system-api.sock',
  systemToken: 'test-system-token',
  throttle: {
    activation: {
      ...defaultApiAuthThrottleConfig.activation,
      route: {
        maxRequests: 20,
        windowMs: 60_000,
      },
      source: {
        blockMs: 600_000,
        maxFailures: 2,
        windowMs: 600_000,
      },
      sourceSubject: {
        blockMs: 600_000,
        maxFailures: 2,
        windowMs: 600_000,
      },
      subject: {
        blockMs: 600_000,
        maxFailures: 2,
        windowMs: 600_000,
      },
    },
    login: {
      ...defaultApiAuthThrottleConfig.login,
      account: {
        blockMs: 600_000,
        maxFailures: 2,
        windowMs: 600_000,
      },
      route: {
        maxRequests: 20,
        windowMs: 60_000,
      },
      source: {
        blockMs: 600_000,
        maxFailures: 2,
        windowMs: 600_000,
      },
      sourceAccount: {
        blockMs: 600_000,
        maxFailures: 2,
        windowMs: 600_000,
      },
    },
    resetPassword: {
      ...defaultApiAuthThrottleConfig.resetPassword,
      route: {
        maxRequests: 20,
        windowMs: 60_000,
      },
      source: {
        blockMs: 600_000,
        maxFailures: 2,
        windowMs: 600_000,
      },
      sourceSubject: {
        blockMs: 600_000,
        maxFailures: 2,
        windowMs: 600_000,
      },
      subject: {
        blockMs: 600_000,
        maxFailures: 2,
        windowMs: 600_000,
      },
    },
  },
  trustedOutboundHosts: [],
  variablesMasterKey: Buffer.from('11'.repeat(32), 'hex'),
  runtimeControlToken: 'test-runtime-control-token',
};

let dbPool!: Pool;
let db!: Database;
let app: ApiApp | null = null;

describe('auth throttle integration', (): void => {
  beforeAll(async (): Promise<void> => {
    await ensureDatabaseExists(authThrottleDatabaseUrl);
  });

  beforeEach(async (): Promise<void> => {
    await resetDatabase(authThrottleDatabaseUrl);
    await runApiMigrations(authThrottleDatabaseUrl);
    dbPool = createDatabasePool(authThrottleDatabaseUrl);
    db = createDatabase(dbPool);
    app = createAuthThrottleApp();
  });

  afterEach(async (): Promise<void> => {
    await closeAuthThrottleApp();
    await dbPool.end();
  });

  it('records failed login pressure and clears account-scoped buckets after a successful login', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(requireAuthThrottleApp());

    const failedLoginResponse: LightMyRequestResponse = await injectLoginRequest({
      email: 'admin@example.com',
      password: 'wrong-password',
      sourceIp: '203.0.113.10',
    });

    expect(failedLoginResponse.statusCode).toBe(401);
    expect(errorResponseSchema.parse(failedLoginResponse.json()).error.code).toBe('invalid_credentials');
    expect(await listThrottleBucketsForAction('auth.login')).toEqual([
      { attemptCount: 1, bucketKind: 'account' },
      { attemptCount: 1, bucketKind: 'source' },
      { attemptCount: 1, bucketKind: 'source_account' },
    ]);

    const successfulLoginResponse: LightMyRequestResponse = await injectLoginRequest({
      email: 'admin@example.com',
      password: 'supersecretpassword',
      sourceIp: '203.0.113.10',
    });

    expect(successfulLoginResponse.statusCode).toBe(200);
    expect(installPayload.organization.slug).toBe('acme-dev');
    expect(await listThrottleBucketsForAction('auth.login')).toEqual([{ attemptCount: 1, bucketKind: 'source' }]);
  });

  it('records failed activation pressure and clears subject-scoped buckets after a successful activation', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(requireAuthThrottleApp());
    const activationToken: string = await inviteAndReadActivationToken(installPayload, 'viewer@example.com');

    const failedActivationResponse: LightMyRequestResponse = await injectActivationRequest({
      bootstrapToken: 'wrong-bootstrap-token',
      email: 'viewer@example.com',
      password: 'viewersecretpassword',
      sourceIp: '203.0.113.11',
    });

    expect(failedActivationResponse.statusCode).toBe(401);
    expect(errorResponseSchema.parse(failedActivationResponse.json()).error.code).toBe('invalid_bootstrap_token');
    expect(await listThrottleBucketsForAction('auth.activate')).toEqual([
      { attemptCount: 1, bucketKind: 'source' },
      { attemptCount: 1, bucketKind: 'source_subject' },
      { attemptCount: 1, bucketKind: 'subject' },
    ]);

    const successfulActivationResponse: LightMyRequestResponse = await injectActivationRequest({
      bootstrapToken: activationToken,
      email: 'viewer@example.com',
      password: 'viewersecretpassword',
      sourceIp: '203.0.113.11',
    });

    expect(successfulActivationResponse.statusCode).toBe(200);
    expect(await listThrottleBucketsForAction('auth.activate')).toEqual([{ attemptCount: 1, bucketKind: 'source' }]);
  });

  it('blocks repeated activation failures for the same email and source', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(requireAuthThrottleApp());
    await inviteAndReadActivationToken(installPayload, 'viewer@example.com');

    const firstFailedActivationResponse: LightMyRequestResponse = await injectActivationRequest({
      bootstrapToken: 'wrong-bootstrap-token-1',
      email: 'viewer@example.com',
      password: 'viewersecretpassword',
      sourceIp: '203.0.113.12',
    });
    const secondFailedActivationResponse: LightMyRequestResponse = await injectActivationRequest({
      bootstrapToken: 'wrong-bootstrap-token-2',
      email: 'viewer@example.com',
      password: 'viewersecretpassword',
      sourceIp: '203.0.113.12',
    });
    const blockedActivationResponse: LightMyRequestResponse = await injectActivationRequest({
      bootstrapToken: 'wrong-bootstrap-token-3',
      email: 'viewer@example.com',
      password: 'viewersecretpassword',
      sourceIp: '203.0.113.12',
    });

    expect(firstFailedActivationResponse.statusCode).toBe(401);
    expect(secondFailedActivationResponse.statusCode).toBe(401);
    expect(blockedActivationResponse.statusCode).toBe(429);
    expect(errorResponseSchema.parse(blockedActivationResponse.json()).error.code).toBe(
      'activation_rate_limit_exceeded',
    );
    expect(Number(blockedActivationResponse.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('persists account throttles across app restarts', async (): Promise<void> => {
    await installCompartment(requireAuthThrottleApp());

    const firstFailedLoginResponse: LightMyRequestResponse = await injectLoginRequest({
      email: 'admin@example.com',
      password: 'wrong-password',
      sourceIp: '203.0.113.21',
    });

    expect(firstFailedLoginResponse.statusCode).toBe(401);

    await restartAuthThrottleApp();

    const secondFailedLoginResponse: LightMyRequestResponse = await injectLoginRequest({
      email: 'admin@example.com',
      password: 'wrong-password',
      sourceIp: '203.0.113.22',
    });

    expect(secondFailedLoginResponse.statusCode).toBe(401);

    const blockedLoginResponse: LightMyRequestResponse = await injectLoginRequest({
      email: 'admin@example.com',
      password: 'wrong-password',
      sourceIp: '203.0.113.23',
    });

    expect(blockedLoginResponse.statusCode).toBe(429);
    expect(errorResponseSchema.parse(blockedLoginResponse.json()).error.code).toBe('login_rate_limit_exceeded');
  });

  it('keeps concurrent login failures from undercounting the same throttle buckets', async (): Promise<void> => {
    await installCompartment(requireAuthThrottleApp());

    const failedLoginResponses: LightMyRequestResponse[] = await Promise.all([
      injectLoginRequest({
        email: 'admin@example.com',
        password: 'wrong-password',
        sourceIp: '203.0.113.41',
      }),
      injectLoginRequest({
        email: 'admin@example.com',
        password: 'wrong-password',
        sourceIp: '203.0.113.41',
      }),
    ]);

    expect(
      failedLoginResponses
        .map((response: LightMyRequestResponse): number => response.statusCode)
        .sort((left: number, right: number): number => left - right),
    ).toEqual([401, 401]);
    expect(await listThrottleBucketsForAction('auth.login')).toEqual([
      { attemptCount: 2, bucketKind: 'account' },
      { attemptCount: 2, bucketKind: 'source' },
      { attemptCount: 2, bucketKind: 'source_account' },
    ]);

    const blockedLoginResponse: LightMyRequestResponse = await injectLoginRequest({
      email: 'admin@example.com',
      password: 'wrong-password',
      sourceIp: '203.0.113.41',
    });

    expect(blockedLoginResponse.statusCode).toBe(429);
    expect(errorResponseSchema.parse(blockedLoginResponse.json()).error.code).toBe('login_rate_limit_exceeded');
  });

  it('blocks one source that sprays multiple login emails', async (): Promise<void> => {
    await installCompartment(requireAuthThrottleApp());

    const firstFailedLoginResponse: LightMyRequestResponse = await injectLoginRequest({
      email: 'first@example.com',
      password: 'wrong-password',
      sourceIp: '203.0.113.31',
    });
    const secondFailedLoginResponse: LightMyRequestResponse = await injectLoginRequest({
      email: 'second@example.com',
      password: 'wrong-password',
      sourceIp: '203.0.113.31',
    });
    const blockedLoginResponse: LightMyRequestResponse = await injectLoginRequest({
      email: 'third@example.com',
      password: 'wrong-password',
      sourceIp: '203.0.113.31',
    });

    expect(firstFailedLoginResponse.statusCode).toBe(401);
    expect(secondFailedLoginResponse.statusCode).toBe(401);
    expect(blockedLoginResponse.statusCode).toBe(429);
    expect(errorResponseSchema.parse(blockedLoginResponse.json()).error.code).toBe('login_rate_limit_exceeded');
  });

  it('records failed password reset pressure and clears subject-scoped buckets after a successful reset', async (): Promise<void> => {
    await installCompartment(requireAuthThrottleApp());
    const resetToken: string = await issueAndReadPasswordResetToken('admin@example.com');

    const failedResetPasswordResponse: LightMyRequestResponse = await injectResetPasswordRequest({
      email: 'admin@example.com',
      password: 'nextsecretpassword',
      resetToken: 'wrong-reset-token',
      sourceIp: '203.0.113.51',
    });

    expect(failedResetPasswordResponse.statusCode).toBe(401);
    expect(errorResponseSchema.parse(failedResetPasswordResponse.json()).error.code).toBe(
      'invalid_password_reset_token',
    );
    expect(await listThrottleBucketsForAction('auth.reset_password')).toEqual([
      { attemptCount: 1, bucketKind: 'source' },
      { attemptCount: 1, bucketKind: 'source_subject' },
      { attemptCount: 1, bucketKind: 'subject' },
    ]);

    const successfulResetPasswordResponse: LightMyRequestResponse = await injectResetPasswordRequest({
      email: 'admin@example.com',
      password: 'nextsecretpassword',
      resetToken,
      sourceIp: '203.0.113.51',
    });

    expect(successfulResetPasswordResponse.statusCode).toBe(200);
    expect(await listThrottleBucketsForAction('auth.reset_password')).toEqual([
      { attemptCount: 1, bucketKind: 'source' },
    ]);
  });

  it('blocks repeated password reset failures for the same email and source', async (): Promise<void> => {
    await installCompartment(requireAuthThrottleApp());

    const firstFailedResetPasswordResponse: LightMyRequestResponse = await injectResetPasswordRequest({
      email: 'admin@example.com',
      password: 'nextsecretpassword',
      resetToken: 'wrong-reset-token-1',
      sourceIp: '203.0.113.52',
    });
    const secondFailedResetPasswordResponse: LightMyRequestResponse = await injectResetPasswordRequest({
      email: 'admin@example.com',
      password: 'nextsecretpassword',
      resetToken: 'wrong-reset-token-2',
      sourceIp: '203.0.113.52',
    });
    const blockedResetPasswordResponse: LightMyRequestResponse = await injectResetPasswordRequest({
      email: 'admin@example.com',
      password: 'nextsecretpassword',
      resetToken: 'wrong-reset-token-3',
      sourceIp: '203.0.113.52',
    });

    expect(firstFailedResetPasswordResponse.statusCode).toBe(401);
    expect(secondFailedResetPasswordResponse.statusCode).toBe(401);
    expect(blockedResetPasswordResponse.statusCode).toBe(429);
    expect(errorResponseSchema.parse(blockedResetPasswordResponse.json()).error.code).toBe(
      'reset_password_rate_limit_exceeded',
    );
    expect(Number(blockedResetPasswordResponse.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('blocks distributed password reset failures against one email', async (): Promise<void> => {
    await installCompartment(requireAuthThrottleApp());

    const firstFailedResetPasswordResponse: LightMyRequestResponse = await injectResetPasswordRequest({
      email: 'admin@example.com',
      password: 'nextsecretpassword',
      resetToken: 'wrong-reset-token-1',
      sourceIp: '203.0.113.61',
    });
    const secondFailedResetPasswordResponse: LightMyRequestResponse = await injectResetPasswordRequest({
      email: 'admin@example.com',
      password: 'nextsecretpassword',
      resetToken: 'wrong-reset-token-2',
      sourceIp: '203.0.113.62',
    });
    const blockedResetPasswordResponse: LightMyRequestResponse = await injectResetPasswordRequest({
      email: 'admin@example.com',
      password: 'nextsecretpassword',
      resetToken: 'wrong-reset-token-3',
      sourceIp: '203.0.113.63',
    });

    expect(firstFailedResetPasswordResponse.statusCode).toBe(401);
    expect(secondFailedResetPasswordResponse.statusCode).toBe(401);
    expect(blockedResetPasswordResponse.statusCode).toBe(429);
    expect(errorResponseSchema.parse(blockedResetPasswordResponse.json()).error.code).toBe(
      'reset_password_rate_limit_exceeded',
    );
  });

  it('persists reset password subject throttles across app restarts', async (): Promise<void> => {
    await installCompartment(requireAuthThrottleApp());

    const firstFailedResetPasswordResponse: LightMyRequestResponse = await injectResetPasswordRequest({
      email: 'admin@example.com',
      password: 'nextsecretpassword',
      resetToken: 'wrong-reset-token-1',
      sourceIp: '203.0.113.53',
    });

    await restartAuthThrottleApp();

    const secondFailedResetPasswordResponse: LightMyRequestResponse = await injectResetPasswordRequest({
      email: 'admin@example.com',
      password: 'nextsecretpassword',
      resetToken: 'wrong-reset-token-2',
      sourceIp: '203.0.113.54',
    });

    await restartAuthThrottleApp();

    const blockedResetPasswordResponse: LightMyRequestResponse = await injectResetPasswordRequest({
      email: 'admin@example.com',
      password: 'nextsecretpassword',
      resetToken: 'wrong-reset-token-3',
      sourceIp: '203.0.113.55',
    });

    expect(firstFailedResetPasswordResponse.statusCode).toBe(401);
    expect(secondFailedResetPasswordResponse.statusCode).toBe(401);
    expect(blockedResetPasswordResponse.statusCode).toBe(429);
    expect(errorResponseSchema.parse(blockedResetPasswordResponse.json()).error.code).toBe(
      'reset_password_rate_limit_exceeded',
    );
  });

  it('blocks one source that sprays multiple reset emails', async (): Promise<void> => {
    await installCompartment(requireAuthThrottleApp());

    const firstFailedResetPasswordResponse: LightMyRequestResponse = await injectResetPasswordRequest({
      email: 'first@example.com',
      password: 'nextsecretpassword',
      resetToken: 'wrong-reset-token-1',
      sourceIp: '203.0.113.71',
    });
    const secondFailedResetPasswordResponse: LightMyRequestResponse = await injectResetPasswordRequest({
      email: 'second@example.com',
      password: 'nextsecretpassword',
      resetToken: 'wrong-reset-token-2',
      sourceIp: '203.0.113.71',
    });
    const blockedResetPasswordResponse: LightMyRequestResponse = await injectResetPasswordRequest({
      email: 'third@example.com',
      password: 'nextsecretpassword',
      resetToken: 'wrong-reset-token-3',
      sourceIp: '203.0.113.71',
    });

    expect(firstFailedResetPasswordResponse.statusCode).toBe(401);
    expect(secondFailedResetPasswordResponse.statusCode).toBe(401);
    expect(blockedResetPasswordResponse.statusCode).toBe(429);
    expect(errorResponseSchema.parse(blockedResetPasswordResponse.json()).error.code).toBe(
      'reset_password_rate_limit_exceeded',
    );
  });
});

interface LoginRequestInput {
  email: string;
  password: string;
  sourceIp: string;
}

interface ActivationRequestInput {
  bootstrapToken: string;
  email: string;
  password: string;
  sourceIp: string;
}

interface ResetPasswordRequestInput {
  email: string;
  password: string;
  resetToken: string;
  sourceIp: string;
}

function createAuthThrottleApp(): ApiApp {
  return createApp({ config: apiConfig });
}

async function closeAuthThrottleApp(): Promise<void> {
  if (app !== null) {
    await app.close();
    app = null;
  }
}

async function restartAuthThrottleApp(): Promise<void> {
  await closeAuthThrottleApp();
  app = createAuthThrottleApp();
}

function requireAuthThrottleApp(): ApiApp {
  const currentApp: ApiApp | null = app;
  if (currentApp === null) {
    throw new Error('Auth throttle app is not available.');
  }

  return currentApp;
}

async function inviteAndReadActivationToken(installPayload: InstallResponse, email: string): Promise<string> {
  const inviteResponse: LightMyRequestResponse = await requireAuthThrottleApp().inject({
    headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
    method: 'POST',
    payload: {
      email,
    },
    url: '/v1/users',
  });
  expect(inviteResponse.statusCode).toBe(200);

  const invitePayload: InviteUserResponse = inviteUserResponseSchema.parse(inviteResponse.json());

  return requireQueryParam(new URL(invitePayload.invitation?.activationUrl ?? ''), 'token');
}

async function issueAndReadPasswordResetToken(email: string): Promise<string> {
  return (await issuePasswordReset({ email })).resetToken;
}

async function injectLoginRequest({ email, password, sourceIp }: LoginRequestInput): Promise<LightMyRequestResponse> {
  return await requireAuthThrottleApp().inject({
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': sourceIp,
    },
    method: 'POST',
    payload: {
      email,
      password,
    },
    url: authApiLoginPathname,
  });
}

async function injectActivationRequest({
  bootstrapToken,
  email,
  password,
  sourceIp,
}: ActivationRequestInput): Promise<LightMyRequestResponse> {
  return await requireAuthThrottleApp().inject({
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': sourceIp,
    },
    method: 'POST',
    payload: {
      bootstrapToken,
      email,
      password,
    },
    url: authApiActivatePathname,
  });
}

async function injectResetPasswordRequest({
  email,
  password,
  resetToken,
  sourceIp,
}: ResetPasswordRequestInput): Promise<LightMyRequestResponse> {
  return await requireAuthThrottleApp().inject({
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': sourceIp,
    },
    method: 'POST',
    payload: {
      email,
      password,
      resetToken,
    },
    url: authApiResetPasswordPathname,
  });
}

async function listThrottleBucketsForAction(action: string): Promise<ThrottleBucketRecord[]> {
  const rows: ThrottleBucketRecord[] = await db
    .select({
      attemptCount: throttleBuckets.attemptCount,
      bucketKind: throttleBuckets.bucketKind,
    })
    .from(throttleBuckets)
    .where(eq(throttleBuckets.action, action));

  return [...rows].sort(compareThrottleBuckets);
}

function compareThrottleBuckets(left: ThrottleBucketRecord, right: ThrottleBucketRecord): number {
  return left.bucketKind.localeCompare(right.bucketKind);
}
