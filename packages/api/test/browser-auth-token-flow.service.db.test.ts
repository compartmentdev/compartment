import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { deriveTestDatabaseUrl, readDatabaseTestMode } from '../../test-support/src';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import { browserAuthTokenFlows } from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import { createBrowserAuthTokenFlow } from '../src/queries/browser-auth-token-flow.query';
import {
  consumeBrowserAuthTokenFlow,
  createBrowserAuthTokenFlowPlan,
  readBrowserAuthTokenFlowToken,
} from '../src/services/browser-auth-token-flow.service';
import { runBrowserAuthTokenFlowCleanup } from '../src/services/browser-auth-token-flow-cleanup.service';
import type { BrowserAuthTokenFlowCleanupResult } from '../src/services/browser-auth-token-flow-cleanup.service.types';
import type { BrowserAuthTokenFlowPlan } from '../src/services/browser-auth-token-flow.service.types';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';

const { testDatabaseUrl } = readDatabaseTestMode();
const browserAuthTokenFlowDatabaseUrl: string = deriveTestDatabaseUrl(testDatabaseUrl, 'browser_auth_token_flow');
const apiConfig: ApiConfig = {
  auditFileSink: defaultAuditFileSinkConfig,
  auditRetentionCleanupBatchSize: 1000,
  auditRetentionCleanupCron: '0 3 * * *',
  auditRetentionCleanupMaxBatches: 100,
  auditRetentionDays: 90,
  baseDomain: 'localhost',
  bindHost: '127.0.0.1',
  caddyTlsMode: 'internal',
  controlPlaneHost: 'compartment.localhost',
  customTlsDirectory: '/etc/compartment/tls',
  databaseUrl: browserAuthTokenFlowDatabaseUrl,
  edgeToken: 'test-edge-token',
  edgeUrl: 'http://127.0.0.1:9081',
  logLevel: 'silent',
  nodeAgentSocketPath: '/tmp/compartment/api-test/node/browser-auth-token-flow.sock',
  port: 9443,
  publicHttpPort: 9080,
  publicHttpsPort: 443,
  publicProtocol: 'http',
  resourceBackupDirectory: '/tmp/compartment-test-resource-backups',
  rollbackRetentionLimit: null,
  runtimeControlToken: 'test-runtime-control-token',
  runtimeDefaultUpstreamHost: '127.0.0.1',
  sessionSecret: 'test-secret',
  sessionTtlMs: 604_800_000,
  sourceArchiveDirectory: '/tmp/compartment-test-source-archives',
  sourceArchiveMaxBytes: 104_857_600,
  systemApiSocketPath: '/tmp/compartment/compartment-test-system-api.sock',
  systemToken: 'test-system-token',
  throttle: defaultApiAuthThrottleConfig,
  trustedOutboundHosts: [],
  variablesMasterKey: parseVariablesMasterKey('11'.repeat(32)),
};
const pool: Pool = createDatabasePool(browserAuthTokenFlowDatabaseUrl);
const db: Database = createDatabase(pool);
type BrowserAuthTokenFlowTableRow = typeof browserAuthTokenFlows.$inferSelect;

interface StoredBrowserAuthTokenFlowCiphertextEnvelope {
  algorithm?: string | undefined;
  encryptionKeyId?: string | undefined;
}

describe('browser auth token flow service db behavior', (): void => {
  useApiRuntimeDatabaseTestHarness({
    apiConfig,
    databaseUrl: browserAuthTokenFlowDatabaseUrl,
    db,
    pool,
  });

  it('stores encrypted token material and consumes each active flow once', async (): Promise<void> => {
    const sourceTokenExpiresAt: Date = new Date('2099-01-01T00:00:00.000Z');
    const flow: BrowserAuthTokenFlowPlan = requireBrowserAuthTokenFlowPlan(
      await createBrowserAuthTokenFlowPlan({
        kind: 'activation',
        sourceTokenExpiresAt,
        token: 'bootstrap-token',
      }),
    );

    expect(flow.expiresAt.getTime()).toBeLessThan(sourceTokenExpiresAt.getTime());

    const storedRows: BrowserAuthTokenFlowTableRow[] = await db
      .select()
      .from(browserAuthTokenFlows)
      .where(eq(browserAuthTokenFlows.id, flow.flowId));

    expect(storedRows).toHaveLength(1);
    expect(storedRows[0]?.tokenCiphertext).not.toContain('bootstrap-token');
    const storedEnvelope: StoredBrowserAuthTokenFlowCiphertextEnvelope = JSON.parse(
      storedRows[0]?.tokenCiphertext ?? '{}',
    ) as StoredBrowserAuthTokenFlowCiphertextEnvelope;
    expect(storedEnvelope.algorithm).toBe('compartment-variable-value');
    expect(storedEnvelope.encryptionKeyId).toMatch(/^install-kek-sha256:/);
    expect(await readBrowserAuthTokenFlowToken('password_reset', flow.flowId)).toBeUndefined();
    expect(await readBrowserAuthTokenFlowToken('activation', flow.flowId)).toBe('bootstrap-token');

    await consumeBrowserAuthTokenFlow('activation', flow.flowId);

    expect(await readBrowserAuthTokenFlowToken('activation', flow.flowId)).toBeUndefined();
  });

  it('caps flow expiration at the source token expiration', async (): Promise<void> => {
    const sourceTokenExpiresAt: Date = new Date(Date.now() + 60_000);
    const flow: BrowserAuthTokenFlowPlan = requireBrowserAuthTokenFlowPlan(
      await createBrowserAuthTokenFlowPlan({
        kind: 'activation',
        sourceTokenExpiresAt,
        token: 'bootstrap-token',
      }),
    );

    expect(flow.expiresAt).toEqual(sourceTokenExpiresAt);
  });

  it('does not persist a flow for already expired source tokens', async (): Promise<void> => {
    const flow: BrowserAuthTokenFlowPlan | undefined = await createBrowserAuthTokenFlowPlan({
      kind: 'activation',
      sourceTokenExpiresAt: new Date('2000-01-01T00:00:00.000Z'),
      token: 'bootstrap-token',
    });

    expect(flow).toBeUndefined();
  });

  it('does not redeem expired flow rows', async (): Promise<void> => {
    await createBrowserAuthTokenFlow({
      expiresAt: new Date('2000-01-01T00:00:00.000Z'),
      id: 'batf_expired',
      kind: 'password_reset',
      tokenCiphertext: 'expired-token-ciphertext',
    });

    expect(await readBrowserAuthTokenFlowToken('password_reset', 'batf_expired')).toBeUndefined();
  });

  it('treats unreadable active flow rows as missing and consumes them', async (): Promise<void> => {
    await createBrowserAuthTokenFlow({
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      id: 'batf_unreadable',
      kind: 'activation',
      tokenCiphertext: 'not-json',
    });

    expect(await readBrowserAuthTokenFlowToken('activation', 'batf_unreadable')).toBeUndefined();

    const storedRows: BrowserAuthTokenFlowTableRow[] = await db
      .select()
      .from(browserAuthTokenFlows)
      .where(eq(browserAuthTokenFlows.id, 'batf_unreadable'));

    expect(storedRows[0]?.consumedAt).toBeInstanceOf(Date);
  });

  it('deletes stale flow rows through the bounded maintenance cleanup', async (): Promise<void> => {
    await createBrowserAuthTokenFlow({
      expiresAt: new Date('2000-01-01T00:00:00.000Z'),
      id: 'batf_cleanup_expired',
      kind: 'activation',
      tokenCiphertext: 'expired-token-ciphertext',
    });
    await createBrowserAuthTokenFlow({
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      id: 'batf_cleanup_consumed',
      kind: 'activation',
      tokenCiphertext: 'consumed-token-ciphertext',
    });
    await consumeBrowserAuthTokenFlow('activation', 'batf_cleanup_consumed');
    await createBrowserAuthTokenFlow({
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      id: 'batf_cleanup_active',
      kind: 'activation',
      tokenCiphertext: 'active-token-ciphertext',
    });

    const result: BrowserAuthTokenFlowCleanupResult = await runBrowserAuthTokenFlowCleanup();

    expect(result.deletedCount).toBe(2);
    expect(await readBrowserAuthTokenFlowRows('batf_cleanup_expired')).toHaveLength(0);
    expect(await readBrowserAuthTokenFlowRows('batf_cleanup_consumed')).toHaveLength(0);
    expect(await readBrowserAuthTokenFlowRows('batf_cleanup_active')).toHaveLength(1);
  });
});

async function readBrowserAuthTokenFlowRows(flowId: string): Promise<BrowserAuthTokenFlowTableRow[]> {
  return await db.select().from(browserAuthTokenFlows).where(eq(browserAuthTokenFlows.id, flowId));
}

function requireBrowserAuthTokenFlowPlan(flow: BrowserAuthTokenFlowPlan | undefined): BrowserAuthTokenFlowPlan {
  if (flow === undefined) {
    throw new Error('Expected browser auth token flow plan.');
  }

  return flow;
}
