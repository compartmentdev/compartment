import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '../../test-support/src';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import { type ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import {
  environmentVariableSetBindings,
  environmentVariableValues,
  environments,
  organizationVariableSetEntries,
  organizationVariableSets,
  organizations,
  principals,
  projects,
  projectServices,
  variableChangeEvents,
  variableAccessEvents,
} from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';
import {
  deleteEnvironmentVariableValueWithAudit,
  importEnvironmentVariableValues,
  insertVariableAccessEvent,
  listEnvironmentVariableSetBindings,
  listEnvironmentVariableValues,
  listOrganizationVariableSetEntriesForSetIds,
  listOrganizationVariableSetNamesByIds,
  upsertEnvironmentVariableValueWithAudit,
} from '../src/queries/variables.query';
import type {
  DeleteEnvironmentVariableValueInput,
  EnvironmentVariableSetBindingRow,
  EnvironmentVariableValueRow,
  InsertVariableAccessEventInput,
  OrganizationVariableSetEntryRow,
  OrganizationVariableSetNameRow,
  UpsertEnvironmentVariableValueInput,
} from '../src/queries/variables.query.types';
import { encryptVariableValueForStorageForTests, type TestEncryptedVariableValue } from './variables-test-crypto';

const { testDatabaseUrl } = readDatabaseTestMode();
const variablesDbDatabaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'variables_db_query');
const variablesMasterKey: Buffer = parseVariablesMasterKey('11'.repeat(32));

const apiConfig: ApiConfig = {
  bindHost: '127.0.0.1',
  baseDomain: 'localhost',
  tlsMode: 'internal',
  controlPlaneHost: 'console.localhost',
  databaseUrl: variablesDbDatabaseUrl,
  edgeToken: 'test-edge-token',
  edgeUrl: 'http://127.0.0.1:9081',
  logLevel: 'silent',
  port: 9443,
  publicProtocol: 'http',
  auditRetentionDays: 90,
  auditRetentionCleanupBatchSize: 1000,
  auditRetentionCleanupCron: '0 3 * * *',
  auditRetentionCleanupMaxBatches: 100,
  auditFileSink: defaultAuditFileSinkConfig,
  rollbackRetentionLimit: null,
  publicHttpPort: 9080,
  publicHttpsPort: 443,
  sessionSecret: 'test-secret',
  sessionTtlMs: 604_800_000,
  sourceArchiveDirectory: '/tmp/compartment-test-source-archives',
  sourceArchiveMaxBytes: 104_857_600,
  throttle: defaultApiAuthThrottleConfig,
  systemApiSocketPath: '/tmp/compartment/compartment-variables-db-system-api.sock',
  systemToken: 'test-system-token',
  trustedOutboundHosts: [],
  variablesMasterKey,
  runtimeControlToken: 'test-runtime-control-token',
};

const pool: Pool = createDatabasePool(variablesDbDatabaseUrl);
const db: Database = createDatabase(pool);

describe('variables db queries', (): void => {
  useApiRuntimeDatabaseTestHarness({
    apiConfig,
    databaseUrl: variablesDbDatabaseUrl,
    db,
    pool,
  });

  it('reads encrypted variable-set entries and bindings from the new tables', async (): Promise<void> => {
    const scope: QueryTestScope = await createQueryTestScope();
    const variableSetId: string = 'vset_postgres_prod';

    await insertOrganizationVariableSet(scope, variableSetId);
    await insertOrganizationVariableSetEntry(variableSetId, 'DATABASE_URL', 'postgres://secret');
    await insertEnvironmentVariableSetBinding(scope, variableSetId);

    const storedEntries: OrganizationVariableSetEntryRow[] = await listOrganizationVariableSetEntriesForSetIds(
      [variableSetId],
      scope.organizationId,
    );
    const storedBindings: EnvironmentVariableSetBindingRow[] = await listEnvironmentVariableSetBindings(
      scope.environmentId,
      scope.organizationId,
    );
    const storedEntry: OrganizationVariableSetEntryRow | undefined = storedEntries[0];

    expect(storedEntries).toHaveLength(1);
    expect(storedEntry).toEqual(
      expect.objectContaining({
        keyName: 'DATABASE_URL',
        organizationVariableSetId: variableSetId,
        sensitivity: 'sensitive',
      }),
    );
    expect(storedEntry?.encryptionKeyId).toMatch(/^install-kek-sha256:/);
    expect(storedEntry?.valueCiphertext).not.toContain('postgres://secret');
    expect(storedEntry?.valueFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(storedBindings).toEqual([
      expect.objectContaining({
        environmentId: scope.environmentId,
        organizationVariableSetId: variableSetId,
        projectServiceId: null,
      }),
    ]);
    await expect(db.select().from(organizationVariableSetEntries)).resolves.toHaveLength(1);
    await expect(db.select().from(environmentVariableSetBindings)).resolves.toHaveLength(1);
  });

  it('excludes archived variable sets from bindings and entry resolution', async (): Promise<void> => {
    const scope: QueryTestScope = await createQueryTestScope();
    const activeVariableSetId: string = 'vset_active';
    const archivedVariableSetId: string = 'vset_archived';

    await insertOrganizationVariableSet(scope, activeVariableSetId);
    await insertOrganizationVariableSet(scope, archivedVariableSetId, new Date('2026-04-07T12:00:00.000Z'));
    await insertOrganizationVariableSetEntry(activeVariableSetId, 'ACTIVE_DATABASE_URL', 'postgres://active');
    await insertOrganizationVariableSetEntry(archivedVariableSetId, 'ARCHIVED_DATABASE_URL', 'postgres://archived');
    await insertEnvironmentVariableSetBinding(scope, activeVariableSetId, 'binding_active');
    await insertEnvironmentVariableSetBinding(scope, archivedVariableSetId, 'binding_archived');

    const storedEntries: OrganizationVariableSetEntryRow[] = await listOrganizationVariableSetEntriesForSetIds(
      [activeVariableSetId, archivedVariableSetId],
      scope.organizationId,
    );
    const storedBindings: EnvironmentVariableSetBindingRow[] = await listEnvironmentVariableSetBindings(
      scope.environmentId,
      scope.organizationId,
    );

    expect(storedEntries.map((row: OrganizationVariableSetEntryRow): string => row.organizationVariableSetId)).toEqual([
      activeVariableSetId,
    ]);
    expect(
      storedBindings.map((row: EnvironmentVariableSetBindingRow): string => row.organizationVariableSetId),
    ).toEqual([activeVariableSetId]);
  });

  it('filters variable-set rows to the environment project organization', async (): Promise<void> => {
    const scope: QueryTestScope = await createQueryTestScope();
    const ownedVariableSetId: string = 'vset_owned';
    const foreignVariableSetId: string = 'vset_foreign';

    await insertOrganizationVariableSet(scope, ownedVariableSetId);
    await insertForeignOrganizationVariableSet(foreignVariableSetId);
    await insertOrganizationVariableSetEntry(ownedVariableSetId, 'OWNED_DATABASE_URL', 'postgres://owned');
    await insertOrganizationVariableSetEntry(foreignVariableSetId, 'FOREIGN_DATABASE_URL', 'postgres://foreign');
    await insertEnvironmentVariableSetBinding(scope, ownedVariableSetId, 'binding_owned');
    await insertEnvironmentVariableSetBinding(scope, foreignVariableSetId, 'binding_foreign');

    const storedBindings: EnvironmentVariableSetBindingRow[] = await listEnvironmentVariableSetBindings(
      scope.environmentId,
      scope.organizationId,
    );
    const foreignOrgBindings: EnvironmentVariableSetBindingRow[] = await listEnvironmentVariableSetBindings(
      scope.environmentId,
      'org_foreign',
    );
    const storedEntries: OrganizationVariableSetEntryRow[] = await listOrganizationVariableSetEntriesForSetIds(
      [ownedVariableSetId, foreignVariableSetId],
      scope.organizationId,
    );
    const storedNames: OrganizationVariableSetNameRow[] = await listOrganizationVariableSetNamesByIds(
      [ownedVariableSetId, foreignVariableSetId],
      scope.organizationId,
    );

    expect(
      storedBindings.map((row: EnvironmentVariableSetBindingRow): string => row.organizationVariableSetId),
    ).toEqual([ownedVariableSetId]);
    expect(foreignOrgBindings).toEqual([]);
    expect(storedEntries.map((row: OrganizationVariableSetEntryRow): string => row.organizationVariableSetId)).toEqual([
      ownedVariableSetId,
    ]);
    expect(storedNames).toEqual([
      {
        id: ownedVariableSetId,
        name: ownedVariableSetId,
      },
    ]);
  });

  it('reads environment variable values from environment and service scopes', async (): Promise<void> => {
    const scope: QueryTestScope = await createQueryTestScope();

    await insertEnvironmentVariableValue(scope.environmentId, null, 'LOG_LEVEL', 'debug', 'plain');
    await insertEnvironmentVariableValue(
      scope.environmentId,
      scope.serviceId,
      'QUEUE_TOKEN',
      'queue-secret',
      'sensitive',
    );

    const storedValues: EnvironmentVariableValueRow[] = await listEnvironmentVariableValues(scope.environmentId);
    const environmentValue: EnvironmentVariableValueRow | undefined = storedValues.find(
      (row: EnvironmentVariableValueRow): boolean => row.keyName === 'LOG_LEVEL',
    );
    const serviceValue: EnvironmentVariableValueRow | undefined = storedValues.find(
      (row: EnvironmentVariableValueRow): boolean => row.keyName === 'QUEUE_TOKEN',
    );

    expect(storedValues).toHaveLength(2);
    expect(environmentValue).toEqual(
      expect.objectContaining({
        keyName: 'LOG_LEVEL',
        projectServiceId: null,
        sensitivity: 'plain',
      }),
    );
    expect(serviceValue).toEqual(
      expect.objectContaining({
        keyName: 'QUEUE_TOKEN',
        projectServiceId: scope.serviceId,
        sensitivity: 'sensitive',
      }),
    );
    expect(environmentValue?.encryptionKeyId).toMatch(/^install-kek-sha256:/);
    expect(environmentValue?.valueCiphertext).not.toContain('debug');
    expect(environmentValue?.valueFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(serviceValue?.valueCiphertext).not.toContain('queue-secret');
  });

  it('rolls back a set when the audit event insert fails', async (): Promise<void> => {
    const scope: QueryTestScope = await createQueryTestScope();
    const input: UpsertEnvironmentVariableValueInput = buildUpsertVariableValueInput(
      scope,
      'FEATURE_FLAG',
      'enabled',
      'plain',
    );

    await expect(
      upsertEnvironmentVariableValueWithAudit(input, {
        actorPrincipalId: 'prn_missing',
        keyNamesJson: JSON.stringify([input.keyName]),
        operation: 'set',
        organizationId: scope.organizationId,
        targetId: scope.environmentId,
        targetType: 'environment',
      }),
    ).rejects.toThrow();

    await expect(db.select().from(environmentVariableValues)).resolves.toEqual([]);
    await expect(db.select().from(variableChangeEvents)).resolves.toEqual([]);
  });

  it('rolls back a remove when the audit event insert fails', async (): Promise<void> => {
    const scope: QueryTestScope = await createQueryTestScope();
    await insertEnvironmentVariableValue(scope.environmentId, null, 'FEATURE_FLAG', 'enabled', 'plain');

    const deleteInput: DeleteEnvironmentVariableValueInput = {
      environmentId: scope.environmentId,
      keyName: 'FEATURE_FLAG',
      projectServiceId: null,
      targetResourceName: null,
    };

    await expect(
      deleteEnvironmentVariableValueWithAudit(deleteInput, {
        actorPrincipalId: 'prn_missing',
        keyNamesJson: JSON.stringify([deleteInput.keyName]),
        operation: 'remove',
        organizationId: scope.organizationId,
        targetId: scope.environmentId,
        targetType: 'environment',
      }),
    ).rejects.toThrow();

    await expect(db.select().from(environmentVariableValues)).resolves.toHaveLength(1);
    await expect(db.select().from(variableChangeEvents)).resolves.toEqual([]);
  });

  it('rolls back an import when the audit event insert fails', async (): Promise<void> => {
    const scope: QueryTestScope = await createQueryTestScope();
    const firstInput: UpsertEnvironmentVariableValueInput = buildUpsertVariableValueInput(
      scope,
      'FEATURE_FLAG',
      'enabled',
      'plain',
    );
    const secondInput: UpsertEnvironmentVariableValueInput = buildUpsertVariableValueInput(
      scope,
      'DATABASE_URL',
      'postgres://db',
      'sensitive',
    );

    await expect(
      importEnvironmentVariableValues({
        changeEvent: {
          actorPrincipalId: 'prn_missing',
          fingerprintsJson: JSON.stringify([firstInput.valueFingerprint, secondInput.valueFingerprint]),
          keyNamesJson: JSON.stringify([firstInput.keyName, secondInput.keyName]),
          operation: 'import',
          organizationId: scope.organizationId,
          sensitivityJson: JSON.stringify([firstInput.sensitivity, secondInput.sensitivity]),
          targetId: scope.environmentId,
          targetType: 'environment',
        },
        values: [firstInput, secondInput],
      }),
    ).rejects.toThrow();

    await expect(db.select().from(environmentVariableValues)).resolves.toEqual([]);
    await expect(db.select().from(variableChangeEvents)).resolves.toEqual([]);
  });

  it('keeps variable access audit rows after target deletion using immutable target snapshots', async (): Promise<void> => {
    const scope: QueryTestScope = await createQueryTestScope();
    const input: InsertVariableAccessEventInput = {
      actorPrincipalId: scope.principalId,
      commandName: 'node',
      environmentId: scope.environmentId,
      fingerprintsJson: JSON.stringify({ DATABASE_URL: 'a'.repeat(64) }),
      id: 'vae_local_run',
      keyNamesJson: JSON.stringify(['DATABASE_URL']),
      operation: 'local_run',
      organizationId: scope.organizationId,
      production: true,
      projectId: 'prj_variables',
      projectServiceId: scope.serviceId,
      targetResourceName: null,
      sensitivityJson: JSON.stringify({ DATABASE_URL: 'sensitive' }),
      targetEnvironmentName: 'production',
      targetProjectName: 'billing',
      targetServiceName: 'api',
    };

    await insertVariableAccessEvent(input);
    await db.delete(projects).where(eq(projects.id, 'prj_variables'));

    const rows: (typeof variableAccessEvents.$inferSelect)[] = await db.select().from(variableAccessEvents);
    expect(rows).toEqual([
      expect.objectContaining({
        environmentId: null,
        projectId: null,
        projectServiceId: null,
        targetResourceName: null,
        targetEnvironmentName: 'production',
        targetProjectName: 'billing',
        targetServiceName: 'api',
      }),
    ]);
    expect(JSON.stringify(rows[0])).not.toContain('postgres://');
  });
});

interface QueryTestScope {
  environmentId: string;
  organizationId: string;
  principalId: string;
  serviceId: string;
}

async function createQueryTestScope(): Promise<QueryTestScope> {
  const principalId: string = 'prn_variables';
  const organizationId: string = 'org_variables';
  const serviceId: string = 'svc_api';
  const environmentId: string = 'env_production';

  await db.insert(principals).values({
    email: 'variables@example.com',
    id: principalId,
    type: 'user',
  });
  await db.insert(organizations).values({
    id: organizationId,
    name: 'Variables Org',
    slug: 'variables-org',
  });
  await db.insert(projects).values({
    id: 'prj_variables',
    name: 'billing',
    organizationId,
    updatedAt: new Date('2026-04-07T09:00:00.000Z'),
  });
  await db.insert(projectServices).values({
    id: serviceId,
    kind: 'web',
    name: 'api',
    path: '.',
    projectId: 'prj_variables',
    updatedAt: new Date('2026-04-07T09:00:00.000Z'),
  });
  await db.insert(environments).values({
    id: environmentId,
    name: 'production',
    projectId: 'prj_variables',
    updatedAt: new Date('2026-04-07T09:00:00.000Z'),
  });

  return {
    environmentId,
    organizationId,
    principalId,
    serviceId,
  };
}

async function insertOrganizationVariableSet(
  scope: QueryTestScope,
  variableSetId: string,
  archivedAt: Date | null = null,
): Promise<void> {
  await db.insert(organizationVariableSets).values({
    archivedAt,
    createdByPrincipalId: scope.principalId,
    description: 'Shared postgres credentials',
    id: variableSetId,
    name: variableSetId,
    organizationId: scope.organizationId,
    updatedAt: new Date('2026-04-07T10:00:00.000Z'),
  });
}

async function insertForeignOrganizationVariableSet(variableSetId: string): Promise<void> {
  await db.insert(organizations).values({
    id: 'org_foreign',
    name: 'Foreign Org',
    slug: 'foreign-org',
  });
  await db.insert(organizationVariableSets).values({
    createdByPrincipalId: null,
    description: 'Foreign credentials',
    id: variableSetId,
    name: variableSetId,
    organizationId: 'org_foreign',
    updatedAt: new Date('2026-04-07T10:00:00.000Z'),
  });
}

async function insertOrganizationVariableSetEntry(
  organizationVariableSetId: string,
  keyName: string,
  valuePlaintext: string,
): Promise<void> {
  const encryptedValue: TestEncryptedVariableValue = encryptVariableValueForStorageForTests(
    valuePlaintext,
    variablesMasterKey,
  );

  await db.insert(organizationVariableSetEntries).values({
    createdByPrincipalId: null,
    encryptionKeyId: encryptedValue.encryptionKeyId,
    id: `${organizationVariableSetId}:${keyName}`,
    keyName,
    organizationVariableSetId,
    sensitivity: 'sensitive',
    updatedByPrincipalId: null,
    valueCiphertext: encryptedValue.valueCiphertext,
    valueFingerprint: encryptedValue.valueFingerprint,
  });
}

async function insertEnvironmentVariableSetBinding(
  scope: QueryTestScope,
  organizationVariableSetId: string,
  bindingId: string = 'binding_prod_postgres',
): Promise<void> {
  await db.insert(environmentVariableSetBindings).values({
    createdByPrincipalId: scope.principalId,
    environmentId: scope.environmentId,
    id: bindingId,
    organizationVariableSetId,
    projectServiceId: null,
  });
}

async function insertEnvironmentVariableValue(
  environmentId: string,
  projectServiceId: string | null,
  keyName: string,
  valuePlaintext: string,
  sensitivity: 'plain' | 'sensitive',
): Promise<void> {
  const encryptedValue: TestEncryptedVariableValue = encryptVariableValueForStorageForTests(
    valuePlaintext,
    variablesMasterKey,
  );

  await db.insert(environmentVariableValues).values({
    createdByPrincipalId: null,
    encryptionKeyId: encryptedValue.encryptionKeyId,
    environmentId,
    id: projectServiceId === null ? `${environmentId}:*:${keyName}` : `${environmentId}:${projectServiceId}:${keyName}`,
    keyName,
    projectServiceId,
    targetResourceName: null,
    sensitivity,
    updatedByPrincipalId: null,
    valueCiphertext: encryptedValue.valueCiphertext,
    valueFingerprint: encryptedValue.valueFingerprint,
  });
}

function buildUpsertVariableValueInput(
  scope: QueryTestScope,
  keyName: string,
  valuePlaintext: string,
  sensitivity: 'plain' | 'sensitive',
): UpsertEnvironmentVariableValueInput {
  const encryptedValue: TestEncryptedVariableValue = encryptVariableValueForStorageForTests(
    valuePlaintext,
    variablesMasterKey,
  );

  return {
    createdByPrincipalId: scope.principalId,
    encryptionKeyId: encryptedValue.encryptionKeyId,
    environmentId: scope.environmentId,
    id: `var_${keyName.toLowerCase()}`,
    keyName,
    projectServiceId: null,
    targetResourceName: null,
    sensitivity,
    updatedAt: new Date('2026-04-07T11:00:00.000Z'),
    updatedByPrincipalId: scope.principalId,
    valueCiphertext: encryptedValue.valueCiphertext,
    valueFingerprint: encryptedValue.valueFingerprint,
  };
}
