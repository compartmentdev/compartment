import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { beforeEach, describe, expect, it } from 'vitest';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '@compartment/test-support';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import { buildArtifacts, organizations, projectServices, projects } from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import { storeBuildArtifactSbom } from '../src/queries/build-artifact-sbom.query';
import type { StoreBuildArtifactSbomInput } from '../src/queries/build-artifact-sbom.query.types';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';

const { testDatabaseUrl } = readDatabaseTestMode();
const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'artifact_sbom');
const pool: Pool = createDatabasePool(databaseUrl);
const db: Database = createDatabase(pool);
const apiConfig: ApiConfig = {
  auditFileSink: defaultAuditFileSinkConfig,
  auditRetentionCleanupBatchSize: 100,
  auditRetentionCleanupCron: '0 3 * * *',
  auditRetentionCleanupMaxBatches: 10,
  auditRetentionDays: 90,
  builderProfileDigest: 'sha256:' + 'e'.repeat(64),
  baseDomain: 'localhost',
  bindHost: '127.0.0.1',
  controlPlaneHost: 'console.localhost',
  databaseUrl,
  edgeToken: 'edge',
  edgeUrl: 'http://edge:9081',
  logLevel: 'silent',
  port: 9443,
  publicHttpPort: 9080,
  publicHttpsPort: 9443,
  publicProtocol: 'http',
  rollbackRetentionLimit: null,
  runtimeControlToken: 'runtime',
  sessionSecret: 'secret',
  sessionTtlMs: 1000,
  sourceArchiveDirectory: '/tmp/source',
  sourceArchiveMaxBytes: 1000,
  systemApiSocketPath: '/tmp/system.sock',
  systemToken: 'system',
  throttle: defaultApiAuthThrottleConfig,
  tlsMode: 'internal',
  trustedOutboundHosts: [],
  usageMeteringIntervalMs: 60_000,
  usageRetentionDays: 400,
  tenantSecretsKek: parseVariablesMasterKey('11'.repeat(32)),
  variablesMasterKey: parseVariablesMasterKey('11'.repeat(32)),
};

describe('build artifact SBOM persistence', (): void => {
  useApiRuntimeDatabaseTestHarness({ apiConfig, databaseUrl, db, pool });

  beforeEach(async (): Promise<void> => {
    await db.insert(organizations).values({ id: 'org_sbom', name: 'SBOM', slug: 'sbom' });
    await db.insert(projects).values({ id: 'prj_sbom', name: 'sbom', organizationId: 'org_sbom' });
    await db
      .insert(projectServices)
      .values({ id: 'svc_sbom', kind: 'web', name: 'web', path: '.', projectId: 'prj_sbom' });
    await db.insert(buildArtifacts).values({
      buildOwnerDeploymentId: 'dep_owner',
      buildState: 'building',
      id: 'art_sbom',
      imageRepository: 'projects/prj_sbom/services/svc_sbom',
      projectId: 'prj_sbom',
      projectServiceId: 'svc_sbom',
      resolvedBuildEnvJson: '{}',
      resolvedBuildJson: '{}',
      sourceDigest: 'v1:sha256:source',
    });
  });

  it('accepts exact retries and rejects stale owners or changed evidence', async (): Promise<void> => {
    const input: StoreBuildArtifactSbomInput = buildInput();
    await expect(storeBuildArtifactSbom(input)).resolves.toBe(true);
    await expect(storeBuildArtifactSbom(input)).resolves.toBe(true);
    await expect(storeBuildArtifactSbom({ ...input, deploymentId: 'dep_stale' })).resolves.toBe(false);
    await expect(storeBuildArtifactSbom({ ...input, imageDigest: `sha256:${'c'.repeat(64)}` })).resolves.toBe(false);
  });
});

function buildInput(): StoreBuildArtifactSbomInput {
  const sbomJson: string = JSON.stringify({ artifacts: [{ name: 'app' }] });
  return {
    artifactId: 'art_sbom',
    deploymentId: 'dep_owner',
    digest: `sha256:${createHash('sha256').update(sbomJson).digest('hex')}`,
    imageDigest: `sha256:${'b'.repeat(64)}`,
    sbomJson,
  };
}
