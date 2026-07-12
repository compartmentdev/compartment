import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '../../test-support/src';
import type { ProductJobIntent, WorkerPersistProductJobResultRequest } from '@compartment/contracts';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import { productJobRuns } from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import {
  claimProductJob,
  persistProductJobFinalized,
  persistProductJobIntent,
  persistProductJobResult,
} from '../src/queries/product-job-runs.query';
import type { ClaimedProductJobQueryResult } from '../src/queries/product-job-runs.query.types';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';

const { testDatabaseUrl } = readDatabaseTestMode();
const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'product_job_runs');
const apiConfig: ApiConfig = buildApiConfig(databaseUrl);
const pool: Pool = createDatabasePool(databaseUrl);
const db: Database = createDatabase(pool);

describe('product Job persistence', (): void => {
  useApiRuntimeDatabaseTestHarness({ apiConfig, databaseUrl, db, pool });

  it('converges duplicate intent and result delivery into one durable full-log row', async (): Promise<void> => {
    const intent: ProductJobIntent = releaseIntent();
    await persistProductJobIntent({ identityId: 'dep_job', intent });
    await persistProductJobIntent({ identityId: 'dep_job', intent });

    const initialClaim: ClaimedProductJobQueryResult = await claimProductJob();
    expect(initialClaim.intent).toMatchObject({ deploymentId: 'dep_job', jobClass: 'release' });
    expect(initialClaim.persistedResult).toBeNull();
    const terminalResult: WorkerPersistProductJobResultRequest = {
      completedAt: '2026-07-12T12:00:00.000Z',
      exitCode: 17,
      identityId: 'dep_job',
      jobClass: 'release',
      jobName: 'cpt-job-dep-job',
      logs: 'first line\nlast line\n',
      podName: 'cpt-job-dep-job-pod',
      status: 'failed',
    };
    await persistProductJobResult(terminalResult);
    await persistProductJobResult(terminalResult);
    await persistProductJobResult({ ...terminalResult, exitCode: 0, logs: 'conflicting', status: 'succeeded' });

    const rows: object[] = await db.select().from(productJobRuns);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ exitCode: 17, logs: 'first line\nlast line\n', status: 'failed' });
    const cleanupClaim: ClaimedProductJobQueryResult = await claimProductJob();
    expect(cleanupClaim.intent).toMatchObject({ deploymentId: 'dep_job', jobClass: 'release' });
    expect(cleanupClaim.persistedResult).toEqual(terminalResult);
    await persistProductJobFinalized('release', 'dep_job');
    expect(await claimProductJob()).toEqual({ intent: null, persistedResult: null });
  });
});

function releaseIntent(): ProductJobIntent {
  return {
    command: ['bin/release'],
    deploymentId: 'dep_job',
    env: { RELEASE: '1' },
    image: 'registry.example/release@sha256:abc',
    jobClass: 'release',
    namespace: 'cpt-prj-job',
    timeoutMs: 30_000,
  };
}

function buildApiConfig(url: string): ApiConfig {
  return {
    auditFileSink: defaultAuditFileSinkConfig,
    auditRetentionCleanupBatchSize: 1_000,
    auditRetentionCleanupCron: '0 3 * * *',
    auditRetentionCleanupMaxBatches: 100,
    auditRetentionDays: 90,
    baseDomain: 'localhost',
    bindHost: '127.0.0.1',
    caddyTlsMode: 'internal',
    controlPlaneHost: 'compartment.localhost',
    customTlsDirectory: '/tmp/tls',
    databaseUrl: url,
    edgeToken: 'edge',
    edgeUrl: 'http://127.0.0.1:9081',
    logLevel: 'silent',
    nodeAgentSocketPath: '/tmp/node.sock',
    port: 9443,
    publicHttpPort: 9080,
    publicHttpsPort: 443,
    publicProtocol: 'http',
    resourceBackupDirectory: '/tmp/backups',
    rollbackRetentionLimit: null,
    runtimeControlToken: 'runtime',
    runtimeDefaultUpstreamHost: '127.0.0.1',
    sessionSecret: 'secret',
    sessionTtlMs: 604_800_000,
    sourceArchiveDirectory: '/tmp/sources',
    sourceArchiveMaxBytes: 104_857_600,
    systemApiSocketPath: '/tmp/system.sock',
    systemToken: 'system',
    throttle: defaultApiAuthThrottleConfig,
    trustedOutboundHosts: [],
    variablesMasterKey: parseVariablesMasterKey('11'.repeat(32)),
  };
}
