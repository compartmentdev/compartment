import type { LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';
import type * as CompartmentSdk from '@compartment/sdk';
import { eq } from 'drizzle-orm';
import {
  errorResponseSchema,
  resourceRestoreAsResponseSchema,
  type InstallResponse,
  type NodeResourceOperationRequest,
  type NodeResourceOperationResponse,
  type NodeResourceRequest,
  type ResourceRestoreAsResponse,
} from '@compartment/contracts';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiApp } from '../src/app.types';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import {
  environmentVariableValues,
  environments,
  nodes,
  operations,
  projectResources,
  projects,
  resourceBackups,
} from '../src/db/schema';
import type { ProjectResourceRow } from '../src/queries/resources.query.types';
import {
  cleanupApiIntegrationRuntime,
  configureApiRuntimeWithPublicIngress,
  createApiIntegrationApps,
  createApiIntegrationTestContext,
} from './api-app-test.harness';
import { useApiDatabaseTestHarness } from './api-db-test.harness';
import { buildOrganizationAuthorizationHeaders, installCompartment } from './api-integration.harness';
import {
  serializeResourceDefinitionSnapshot,
  type StoredResourceEnvSource,
  type StoredResourceOperationConfig,
} from '../src/services/resources.service.storage';
import { encryptVariableValueForStorageForTests, type TestEncryptedVariableValue } from './variables-test-crypto';

type ReconcileNodeResource = typeof CompartmentSdk.reconcileNodeResource;
type RunNodeResourceRestoreOperation = typeof CompartmentSdk.runNodeResourceRestoreOperation;
type AppAccessEdgeMutation = () => Promise<void>;

interface ParsedErrorBody {
  code: string;
}

interface ParsedErrorResponse {
  error: ParsedErrorBody;
}

interface SdkMocks {
  reconcileNodeResource: Mock<ReconcileNodeResource>;
  runNodeResourceRestoreOperation: Mock<RunNodeResourceRestoreOperation>;
}

interface AppAccessEdgeServiceMocks {
  invalidateEdgeAppAccessSessions: Mock<AppAccessEdgeMutation>;
  synchronizeEdgeAppAccessState: Mock<AppAccessEdgeMutation>;
}

interface RestoreRouteScenarioInput {
  backupId?: string | undefined;
  organizationId: string;
  resourceDefinitionJson?: string | null | undefined;
  restoreOperation?: StoredResourceOperationConfig | null | undefined;
  targetAlreadyExists?: boolean | undefined;
}

const sdkMocks: SdkMocks = vi.hoisted(
  (): SdkMocks => ({
    reconcileNodeResource: vi.fn<ReconcileNodeResource>(),
    runNodeResourceRestoreOperation: vi.fn<RunNodeResourceRestoreOperation>(),
  }),
);

const appAccessEdgeServiceMocks: AppAccessEdgeServiceMocks = vi.hoisted(
  (): AppAccessEdgeServiceMocks => ({
    invalidateEdgeAppAccessSessions: vi.fn<AppAccessEdgeMutation>(),
    synchronizeEdgeAppAccessState: vi.fn<AppAccessEdgeMutation>(),
  }),
);

vi.mock('@compartment/sdk', async (): Promise<typeof CompartmentSdk> => {
  const actual: typeof CompartmentSdk = await vi.importActual('@compartment/sdk');

  return {
    ...actual,
    reconcileNodeResource: sdkMocks.reconcileNodeResource,
    runNodeResourceRestoreOperation: sdkMocks.runNodeResourceRestoreOperation,
  };
});

vi.mock(
  '../src/services/app-access-edge.service',
  (): AppAccessEdgeServiceMocks => ({
    invalidateEdgeAppAccessSessions: appAccessEdgeServiceMocks.invalidateEdgeAppAccessSessions,
    synchronizeEdgeAppAccessState: appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState,
  }),
);

const { apiConfig, databaseUrl } = createApiIntegrationTestContext(
  'resource_backups_restore_as_route',
  'resource-backups-restore-as-route',
);

let pool!: Pool;
let db!: Database;
let app!: ApiApp;
let systemApp!: ApiApp;

describe('resource backup restore-as route integration', (): void => {
  useApiDatabaseTestHarness(databaseUrl);

  beforeEach(async (): Promise<void> => {
    vi.clearAllMocks();
    appAccessEdgeServiceMocks.invalidateEdgeAppAccessSessions.mockResolvedValue(undefined);
    appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockResolvedValue(undefined);
    sdkMocks.reconcileNodeResource.mockResolvedValue({
      containerId: 'container_restore',
      hostname: 'postgres-restore.production.smoke-web.resource.internal',
      status: 'running',
    });
    sdkMocks.runNodeResourceRestoreOperation.mockResolvedValue({
      stderr: '',
      stdout: 'restored',
    } satisfies NodeResourceOperationResponse);
    pool = createDatabasePool(databaseUrl);
    db = createDatabase(pool);
    ({ app, systemApp } = await createApiIntegrationApps(apiConfig, db, pool));
    configureApiRuntimeWithPublicIngress(apiConfig, db);
  });

  afterEach(async (): Promise<void> => {
    await cleanupApiIntegrationRuntime(app, systemApp, pool);
  });

  it('restores a resource backup into a new resource', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await seedRestoreRouteScenario({ organizationId: installPayload.organization.id });

    const response: LightMyRequestResponse = await postRestoreAs(installPayload, 'rbak_restore_as');

    expect(response.statusCode, response.body).toBe(200);
    const payload: ResourceRestoreAsResponse = resourceRestoreAsResponseSchema.parse(response.json());
    expect(payload.resource).toMatchObject({
      hostname: 'postgres-restore.production.smoke-web.resource.internal',
      name: 'postgres-restore',
      status: 'running',
    });
    expect(payload.restoredBackup.id).toBe('rbak_restore_as');
    expect(sdkMocks.runNodeResourceRestoreOperation).toHaveBeenCalledTimes(1);
  });

  it('copies source resource direct variables into the restored resource runtime', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await seedRestoreRouteScenario({ organizationId: installPayload.organization.id });
    await insertSourceResourceVariable('POSTGRES_PASSWORD', 'source-secret');

    const response: LightMyRequestResponse = await postRestoreAs(installPayload, 'rbak_restore_as');

    expect(response.statusCode, response.body).toBe(200);
    expectReconcileRequestEnv('POSTGRES_PASSWORD', 'source-secret');
    expectRestoreOperationEnv('POSTGRES_PASSWORD', 'source-secret');
    await expectResourceVariableTargets('POSTGRES_PASSWORD', ['postgres', 'postgres-restore']);
  });

  it('rejects restore-as for old backups without resource definition snapshots', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await seedRestoreRouteScenario({
      backupId: 'rbak_old',
      organizationId: installPayload.organization.id,
      resourceDefinitionJson: null,
    });

    const response: LightMyRequestResponse = await postRestoreAs(installPayload, 'rbak_old');

    expectError(response, 400, 'invalid_deploy_config');
    expect(response.body).toContain('created before resource definition snapshots were recorded');
    expect(await listResourceNames()).toEqual(['postgres']);
    expect(sdkMocks.reconcileNodeResource).not.toHaveBeenCalled();
    expect(sdkMocks.runNodeResourceRestoreOperation).not.toHaveBeenCalled();
  });

  it('rejects restore-as when the snapshot has no restore operation', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await seedRestoreRouteScenario({
      backupId: 'rbak_no_restore',
      organizationId: installPayload.organization.id,
      restoreOperation: null,
    });

    const response: LightMyRequestResponse = await postRestoreAs(installPayload, 'rbak_no_restore');

    expectError(response, 400, 'invalid_deploy_config');
    expect(response.body).toContain('cannot restore a resource without a restore operation');
    expect(await listResourceNames()).toEqual(['postgres']);
    expect(sdkMocks.reconcileNodeResource).not.toHaveBeenCalled();
    expect(sdkMocks.runNodeResourceRestoreOperation).not.toHaveBeenCalled();
  });

  it('rejects restore-as before creating a resource when stored operation env uses legacy variables', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await seedRestoreRouteScenario({
      backupId: 'rbak_missing_restore_variable',
      organizationId: installPayload.organization.id,
      restoreOperation: createStoredRestoreOperationWithMissingVariable(),
    });

    const response: LightMyRequestResponse = await postRestoreAs(installPayload, 'rbak_missing_restore_variable');

    expectError(response, 400, 'invalid_deploy_config');
    expect(response.body).toContain(
      'Resource environment PGPASSWORD uses unsupported legacy source type variable. Resource descriptor env is literal-only; move secrets to resource-scoped variables.',
    );
    expect(await listResourceNames()).toEqual(['postgres']);
    expect(sdkMocks.reconcileNodeResource).not.toHaveBeenCalled();
    expect(sdkMocks.runNodeResourceRestoreOperation).not.toHaveBeenCalled();
  });

  it('rejects restore-as when the target name already exists', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await seedRestoreRouteScenario({
      backupId: 'rbak_conflict',
      organizationId: installPayload.organization.id,
      targetAlreadyExists: true,
    });

    const response: LightMyRequestResponse = await postRestoreAs(installPayload, 'rbak_conflict');

    expectError(response, 409, 'resource_name_taken');
    expect(await listResourceNames()).toEqual(['postgres', 'postgres-restore']);
    expect(sdkMocks.reconcileNodeResource).not.toHaveBeenCalled();
    expect(sdkMocks.runNodeResourceRestoreOperation).not.toHaveBeenCalled();
  });

  it('keeps the created resource when restore-as operation fails', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await seedRestoreRouteScenario({
      backupId: 'rbak_restore_failure',
      organizationId: installPayload.organization.id,
    });
    sdkMocks.runNodeResourceRestoreOperation.mockRejectedValueOnce(new Error('pg_restore failed'));

    const response: LightMyRequestResponse = await postRestoreAs(installPayload, 'rbak_restore_failure');

    expectError(response, 400, 'invalid_deploy_config');
    expect(response.body).toContain(
      'Resource postgres-restore was created, but restore failed: pg_restore failed. Delete the resource before retrying.',
    );
    expect(await listResourceNames()).toEqual(['postgres', 'postgres-restore']);
  });
});

async function postRestoreAs(installPayload: InstallResponse, backupId: string): Promise<LightMyRequestResponse> {
  return await app.inject({
    headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
    method: 'POST',
    payload: {
      targetResourceName: 'postgres-restore',
    },
    url: `/v1/resource-backups/${backupId}/restore?projectName=smoke-web`,
  });
}

async function seedRestoreRouteScenario(input: RestoreRouteScenarioInput): Promise<void> {
  await db.insert(nodes).values({
    id: 'node_restore_as',
    name: 'node-restore-as',
    nodeUrl: '/tmp/compartment/api-test/node/restore-as.sock',
    nodeSocketPath: '/tmp/compartment/api-test/node/restore-as.sock',
    nodeVersion: '0.1.0',
  });
  await db.insert(projects).values({
    id: 'prj_smoke_web',
    name: 'smoke-web',
    organizationId: input.organizationId,
  });
  await db.insert(environments).values({
    id: 'env_production',
    name: 'production',
    nodeId: 'node_restore_as',
    projectId: 'prj_smoke_web',
  });
  await db.insert(projectResources).values(createResourceInsert('res_postgres', 'postgres'));
  if (input.targetAlreadyExists === true) {
    await db.insert(projectResources).values(createResourceInsert('res_postgres_restore', 'postgres-restore'));
  }
  await db.insert(operations).values({
    id: 'op_restore_as_backup',
    status: 'succeeded',
    summary: 'Resource postgres backup succeeded.',
    targetId: 'res_postgres',
    targetType: 'resource',
    type: 'resource.backup',
  });
  await db.insert(resourceBackups).values({
    artifactLocation: '/tmp/compartment-test-resource-backups/rbak_restore_as',
    checksum: 'sha256:abc123',
    completedAt: new Date('2026-05-08T12:05:00.000Z'),
    createdAt: new Date('2026-05-08T12:00:00.000Z'),
    createdByPrincipalId: null,
    id: input.backupId ?? 'rbak_restore_as',
    manifestJson: '{"backupId":"rbak_restore_as","status":"succeeded"}',
    operationId: 'op_restore_as_backup',
    projectResourceId: 'res_postgres',
    purpose: 'manual',
    resourceDefinitionJson:
      input.resourceDefinitionJson === undefined
        ? serializeResourceDefinitionSnapshot(createSourceResourceRow(input.restoreOperation))
        : input.resourceDefinitionJson,
    sizeBytes: 128,
    status: 'succeeded',
  });
}

function createResourceInsert(id: string, name: string): typeof projectResources.$inferInsert {
  const resource: ProjectResourceRow = name === 'postgres' ? createSourceResourceRow() : createRestoredResourceRow();

  return {
    commandJson: resource.commandJson,
    containerId: resource.containerId,
    envJson: resource.envJson,
    environmentId: resource.environmentId,
    hostname: resource.hostname,
    id,
    image: resource.image,
    name,
    operationConfigHash: resource.operationConfigHash,
    operationsJson: resource.operationsJson,
    portsJson: resource.portsJson,
    readinessJson: resource.readinessJson,
    restartPolicy: resource.restartPolicy,
    runtimeDefinitionHash: resource.runtimeDefinitionHash,
    status: resource.status,
    volumesJson: resource.volumesJson,
  };
}

function createSourceResourceRow(
  restoreOperation: StoredResourceOperationConfig | null | undefined = createStoredRestoreOperation(),
): ProjectResourceRow {
  const now: Date = new Date('2026-05-08T12:00:00.000Z');

  return {
    commandJson: '[]',
    containerId: 'container_postgres',
    createdAt: now,
    envJson: '[]',
    environmentId: 'env_production',
    hostname: 'postgres.production.smoke-web.resource.internal',
    id: 'res_postgres',
    image: 'postgres:16',
    name: 'postgres',
    operationConfigHash: 'operation_hash',
    operationsJson: JSON.stringify(createStoredOperations(restoreOperation)),
    portsJson: '[5432]',
    readinessJson: 'null',
    restartPolicy: 'unless-stopped',
    runtimeDefinitionHash: 'runtime_hash',
    status: 'running',
    updatedAt: now,
    volumesJson: '[{"name":"postgres-data","mountPath":"/var/lib/postgresql/data"}]',
  };
}

function createRestoredResourceRow(): ProjectResourceRow {
  return {
    ...createSourceResourceRow(),
    containerId: 'container_restore',
    hostname: 'postgres-restore.production.smoke-web.resource.internal',
    id: 'res_postgres_restore',
    name: 'postgres-restore',
    volumesJson: '[]',
  };
}

function createStoredOperations(
  restoreOperation: StoredResourceOperationConfig | null = createStoredRestoreOperation(),
): {
  backup: StoredResourceOperationConfig;
  restore: StoredResourceOperationConfig | null;
} {
  return {
    backup: {
      command: 'pg_dump --file "$COMPARTMENT_BACKUP_DIR/dump.sql"',
      env: [],
      image: null,
      schedule: null,
    },
    restore: restoreOperation,
  };
}

function createStoredRestoreOperation(): StoredResourceOperationConfig {
  return {
    command: 'pg_restore "$COMPARTMENT_BACKUP_DIR/dump.sql"',
    env: [],
    image: null,
    schedule: null,
  };
}

function createStoredRestoreOperationWithMissingVariable(): StoredResourceOperationConfig {
  return {
    ...createStoredRestoreOperation(),
    env: [createVariableEnvSource('PGPASSWORD', 'POSTGRES_PASSWORD')],
  };
}

function createVariableEnvSource(keyName: string, variableName: string): StoredResourceEnvSource {
  return {
    keyName,
    literalValue: null,
    sourceType: 'variable',
    variableName,
  };
}

async function listResourceNames(): Promise<string[]> {
  const rows: { name: string }[] = await db
    .select({ name: projectResources.name })
    .from(projectResources)
    .orderBy(projectResources.name);

  return rows.map((row: { name: string }): string => row.name);
}

async function insertSourceResourceVariable(keyName: string, value: string): Promise<void> {
  const encryptedValue: TestEncryptedVariableValue = encryptVariableValueForStorageForTests(
    value,
    apiConfig.variablesMasterKey,
  );

  await db.insert(environmentVariableValues).values({
    createdByPrincipalId: null,
    encryptionKeyId: encryptedValue.encryptionKeyId,
    environmentId: 'env_production',
    id: `var_source_${keyName.toLowerCase()}`,
    keyName,
    projectServiceId: null,
    sensitivity: 'sensitive',
    targetResourceName: 'postgres',
    updatedByPrincipalId: null,
    valueCiphertext: encryptedValue.valueCiphertext,
    valueFingerprint: encryptedValue.valueFingerprint,
  });
}

function expectReconcileRequestEnv(keyName: string, value: string): void {
  const request: NodeResourceRequest | undefined = sdkMocks.reconcileNodeResource.mock.calls[0]?.[1];

  expect(request?.definition.env).toEqual(
    expect.arrayContaining([
      {
        keyName,
        value,
      },
    ]),
  );
}

function expectRestoreOperationEnv(keyName: string, value: string): void {
  const request: NodeResourceOperationRequest | undefined = sdkMocks.runNodeResourceRestoreOperation.mock.calls[0]?.[1];

  expect(request?.definition.env).toEqual(
    expect.arrayContaining([
      {
        keyName,
        value,
      },
    ]),
  );
}

async function expectResourceVariableTargets(keyName: string, targetResourceNames: string[]): Promise<void> {
  const rows: { targetResourceName: string | null }[] = await db
    .select({ targetResourceName: environmentVariableValues.targetResourceName })
    .from(environmentVariableValues)
    .where(eq(environmentVariableValues.keyName, keyName))
    .orderBy(environmentVariableValues.targetResourceName);

  expect(rows.map((row: { targetResourceName: string | null }): string | null => row.targetResourceName)).toEqual(
    targetResourceNames,
  );
}

function expectError(response: LightMyRequestResponse, statusCode: number, code: string): void {
  expect(response.statusCode, response.body).toBe(statusCode);
  const error: ParsedErrorResponse = errorResponseSchema.parse(response.json());
  expect(error.error.code).toBe(code);
}
