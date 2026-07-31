import { asc, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '@compartment/test-support';
import type {
  AuditEventType,
  ResourceBackupCreateResponse,
  ResourceResponse,
  ResourceRestoreResponse,
} from '@compartment/contracts';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import { auditEvents, authSessions, environments, organizations, principals, projects } from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import type { CurrentOrganizationAccess } from '../src/http/request.types';
import type { Actor } from '../src/services/auth-actor.types';
import { configureApiRuntime } from '../src/runtime/runtime';
import { runAuditRetentionCleanup } from '../src/services/audit-retention-cleanup.service';
import {
  recordResourceAuditEvent,
  recordResourceBackupCreatedAuditEvent,
  recordResourceBackupRestoredAuditEvent,
  recordResourceDeletedAuditEvent,
} from '../src/routes/audit/privileged-operation-audit';
import type { AuditRetentionCleanupResult } from '../src/services/audit-retention-cleanup.service.types';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';

const { testDatabaseUrl } = readDatabaseTestMode();
const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'audit_jobs_service');
const apiConfig: ApiConfig = {
  auditRetentionDays: 90,
  auditRetentionCleanupBatchSize: 1000,
  auditRetentionCleanupCron: '0 3 * * *',
  auditRetentionCleanupMaxBatches: 100,
  usageMeteringIntervalMs: 60_000,
  usageRetentionDays: 400,
  auditFileSink: defaultAuditFileSinkConfig,
  baseDomain: 'localhost',
  bindHost: '127.0.0.1',
  tlsMode: 'internal',
  controlPlaneHost: 'console.localhost',
  databaseUrl,
  edgeToken: 'test-edge-token',
  edgeUrl: 'http://127.0.0.1:9081',
  logLevel: 'silent',
  port: 9443,
  publicHttpPort: 9080,
  publicHttpsPort: 443,
  publicProtocol: 'http',
  rollbackRetentionLimit: null,
  runtimeControlToken: 'test-runtime-control-token',
  sessionSecret: 'test-secret',
  sessionTtlMs: 604_800_000,
  sourceArchiveDirectory: '/tmp/compartment-test-source-archives',
  sourceArchiveMaxBytes: 104_857_600,
  systemApiSocketPath: '/tmp/compartment/compartment-test-system-api.sock',
  systemToken: 'test-system-token',
  throttle: defaultApiAuthThrottleConfig,
  trustedOutboundHosts: [],
  tenantSecretsKek: parseVariablesMasterKey('11'.repeat(32)),
  variablesMasterKey: parseVariablesMasterKey('11'.repeat(32)),
};
const pool: Pool = createDatabasePool(databaseUrl);
const db: Database = createDatabase(pool);
const dayMs: number = 24 * 60 * 60 * 1000;

interface AuditEventIdRow {
  id: string;
}

interface SeedOrganizationInput {
  id: string;
  name?: string | undefined;
  slug?: string | undefined;
}

interface ResourceAuditRequestShape {
  actor: Actor;
  authTransport: 'bearer';
  currentOrganization: CurrentOrganizationAccess;
  headers: Record<string, string>;
  ip: string;
}

describe('audit jobs services', (): void => {
  useApiRuntimeDatabaseTestHarness({ apiConfig, databaseUrl, db, pool });

  it('deletes expired organization audit events using effective retention policies', async (): Promise<void> => {
    await seedRetentionOrganizations();
    await seedAuditEvent('aud_inherit_expired', 'org_inherit', daysAgo(120));
    await seedAuditEvent('aud_inherit_recent', 'org_inherit', daysAgo(30));
    await seedAuditEvent('aud_keep_expired', 'org_keep', daysAgo(10));
    await seedAuditEvent('aud_keep_recent', 'org_keep', daysAgo(3));
    await seedAuditEvent('aud_indefinite_old', 'org_indefinite', daysAgo(365));

    const result: AuditRetentionCleanupResult = await runAuditRetentionCleanup();

    expect(result.deletedCount).toBe(2);
    expect(await listAuditEventIds()).toEqual(['aud_indefinite_old', 'aud_inherit_recent', 'aud_keep_recent']);
    expect(result.organizations).toEqual(
      expect.arrayContaining([
        {
          deletedCount: 1,
          effectivePolicy: { days: 90, mode: 'keep_days' },
          organizationId: 'org_inherit',
        },
        {
          deletedCount: 1,
          effectivePolicy: { days: 7, mode: 'keep_days' },
          organizationId: 'org_keep',
        },
        {
          deletedCount: 0,
          effectivePolicy: { days: null, mode: 'indefinite' },
          organizationId: 'org_indefinite',
        },
      ]),
    );
  });

  it('respects configured audit retention cleanup batch limits', async (): Promise<void> => {
    configureApiRuntime({
      config: {
        ...apiConfig,
        auditRetentionCleanupBatchSize: 1,
        auditRetentionCleanupMaxBatches: 1,
        usageMeteringIntervalMs: 60_000,
        usageRetentionDays: 400,
      },
      db,
    });
    await seedOrganization({ id: 'org_batch_limit', slug: 'org-batch-limit' });
    await seedAuditEvent('aud_batch_limit_1', 'org_batch_limit', daysAgo(120));
    await seedAuditEvent('aud_batch_limit_2', 'org_batch_limit', daysAgo(121));

    const result: AuditRetentionCleanupResult = await runAuditRetentionCleanup();

    expect(result.deletedCount).toBe(1);
    expect(await listAuditEventIds()).toEqual(['aud_batch_limit_1']);
  });

  it('deletes expired privileged-operation event types without special cases', async (): Promise<void> => {
    await seedOrganization({ id: 'org_privileged_audit', slug: 'org-privileged-audit' });
    const privilegedEventTypes: AuditEventType[] = [
      'authentication.login',
      'authorization.denied',
      'deployment.created',
      'deployment.rolled_back',
      'installation.owner.activated',
      'resource.backup.created',
      'resource.backup.restored',
      'resource.bootstrapped',
      'resource.deleted',
      'resource.started',
      'resource.stopped',
      'service.access_mode.changed',
      'variable.changed',
    ];
    for (const [index, eventType] of privilegedEventTypes.entries()) {
      await seedAuditEvent(`aud_privileged_expired_${index}`, 'org_privileged_audit', daysAgo(120), eventType);
    }
    await seedAuditEvent('aud_privileged_recent', 'org_privileged_audit', daysAgo(1), 'resource.backup.restored');

    const result: AuditRetentionCleanupResult = await runAuditRetentionCleanup();

    expect(result.deletedCount).toBe(privilegedEventTypes.length);
    expect(await listAuditEventIds()).toEqual(['aud_privileged_recent']);
  });

  it('persists scoped resource lifecycle and backup audit events', async (): Promise<void> => {
    await seedResourceAuditScope();
    const request: FastifyRequest = buildResourceAuditRequest();
    const response: ResourceResponse = buildResourceResponse();
    const backupResponse: ResourceBackupCreateResponse = buildResourceBackupResponse(response);
    const restoreResponse: ResourceRestoreResponse = buildResourceRestoreResponse(response, backupResponse);

    await recordResourceAuditEvent(request, response, 'resource.bootstrapped');
    await recordResourceAuditEvent(request, response, 'resource.started');
    await recordResourceAuditEvent(request, response, 'resource.stopped');
    await recordResourceDeletedAuditEvent(request, response, true);
    await recordResourceBackupCreatedAuditEvent(request, backupResponse);
    await recordResourceBackupRestoredAuditEvent(request, restoreResponse);

    const rows: (typeof auditEvents.$inferSelect)[] = await db
      .select()
      .from(auditEvents)
      .orderBy(asc(auditEvents.eventType));
    expect(rows.map((row: typeof auditEvents.$inferSelect): string => row.eventType)).toEqual([
      'resource.backup.created',
      'resource.backup.restored',
      'resource.bootstrapped',
      'resource.deleted',
      'resource.started',
      'resource.stopped',
    ]);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorEmail: 'operator@example.com',
          actorPrincipalId: 'prn_resource_audit',
          environmentId: 'env_resource_audit',
          organizationId: 'org_resource_audit',
          projectId: 'prj_resource_audit',
          status: 'succeeded',
          targetId: 'res_postgres',
          targetType: 'resource',
        }),
      ]),
    );
  });
});

async function seedRetentionOrganizations(): Promise<void> {
  await seedOrganization({ id: 'org_inherit', slug: 'org-inherit' });
  await seedOrganization({ id: 'org_keep', slug: 'org-keep' });
  await seedOrganization({ id: 'org_indefinite', slug: 'org-indefinite' });
  await db
    .update(organizations)
    .set({ auditRetentionDays: 7, auditRetentionMode: 'keep_days' })
    .where(eq(organizations.id, 'org_keep'));
  await db
    .update(organizations)
    .set({ auditRetentionDays: null, auditRetentionMode: 'indefinite' })
    .where(eq(organizations.id, 'org_indefinite'));
}

async function seedOrganization(input: SeedOrganizationInput): Promise<void> {
  await db.insert(organizations).values({
    id: input.id,
    name: input.name ?? 'Acme Dev',
    slug: input.slug ?? 'acme-dev',
  });
}

async function seedAuditEvent(
  id: string,
  organizationId: string,
  occurredAt: Date,
  eventType: AuditEventType = 'organization.settings.updated',
): Promise<void> {
  await db.insert(auditEvents).values({
    actorType: 'system',
    eventType,
    id,
    metadataJson: '{}',
    occurredAt,
    organizationId,
    scopeType: 'organization',
    status: 'succeeded',
    targetId: organizationId,
    targetType: 'organization',
  });
}

async function listAuditEventIds(): Promise<string[]> {
  const rows: AuditEventIdRow[] = await db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .orderBy(asc(auditEvents.id));

  return rows.map((row: AuditEventIdRow): string => row.id);
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * dayMs);
}

async function seedResourceAuditScope(): Promise<void> {
  await db.insert(principals).values({ email: 'operator@example.com', id: 'prn_resource_audit', type: 'user' });
  await seedOrganization({ id: 'org_resource_audit', slug: 'resource-audit' });
  await db.insert(authSessions).values({
    authMethodKind: 'password',
    expiresAt: new Date('2026-08-01T00:00:00.000Z'),
    id: 'ses_resource_audit',
    organizationId: 'org_resource_audit',
    principalId: 'prn_resource_audit',
    tokenHash: 'resource-audit-token-hash',
  });
  await db.insert(projects).values({
    id: 'prj_resource_audit',
    name: 'database',
    organizationId: 'org_resource_audit',
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
  });
  await db.insert(environments).values({
    id: 'env_resource_audit',
    name: 'production',
    projectId: 'prj_resource_audit',
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
  });
}

function buildResourceAuditRequest(): FastifyRequest {
  const request: ResourceAuditRequestShape = {
    actor: {
      authSession: {
        authMethodKind: 'password',
        oidcProviderId: null,
        organizationId: 'org_resource_audit',
        principalId: 'prn_resource_audit',
      },
      principalEmail: 'operator@example.com',
      principalId: 'prn_resource_audit',
      principalType: 'user',
      sessionId: 'ses_resource_audit',
      tokenHash: 'unused',
    },
    authTransport: 'bearer',
    currentOrganization: { id: 'org_resource_audit', slug: 'resource-audit' },
    headers: { 'user-agent': 'audit-test' },
    ip: '127.0.0.1',
  };
  return request as FastifyRequest;
}

function buildResourceResponse(): ResourceResponse {
  const timestamp: string = '2026-07-01T00:00:00.000Z';
  return {
    environment: {
      createdAt: timestamp,
      id: 'env_resource_audit',
      name: 'production',
      projectId: 'prj_resource_audit',
      updatedAt: timestamp,
    },
    project: {
      archivedAt: null,
      createdAt: timestamp,
      id: 'prj_resource_audit',
      name: 'database',
      organizationId: 'org_resource_audit',
      updatedAt: timestamp,
    },
    resource: {
      createdAt: timestamp,
      env: [],
      id: 'res_postgres',
      image: 'postgres:17',
      name: 'postgres',
      ports: [5432],
      readiness: null,
      status: 'running',
      updatedAt: timestamp,
      volumes: [],
    },
  };
}

function buildResourceBackupResponse(response: ResourceResponse): ResourceBackupCreateResponse {
  return {
    backup: {
      artifactLocation: 'pvc://backup',
      checksum: 'ab'.repeat(32),
      completedAt: '2026-07-01T00:01:00.000Z',
      createdAt: '2026-07-01T00:00:00.000Z',
      failureSummary: null,
      id: 'rbak_resource_audit',
      purpose: 'manual',
      resource: response.resource,
      retentionDeletedAt: null,
      retentionReason: null,
      size: 42,
      status: 'succeeded',
    },
    environment: response.environment,
    project: response.project,
  };
}

function buildResourceRestoreResponse(
  response: ResourceResponse,
  backupResponse: ResourceBackupCreateResponse,
): ResourceRestoreResponse {
  return {
    environment: response.environment,
    preRestoreBackup: { ...backupResponse.backup, id: 'rbak_pre_restore' },
    project: response.project,
    resource: response.resource,
    restoredBackup: backupResponse.backup,
    success: true,
  };
}
