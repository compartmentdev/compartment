import type { LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';
import {
  errorResponseSchema,
  type CompartmentAuthoredDescriptorInput,
  type InstallResponse,
  type ResourceReadinessSummary,
  type ResourceReconcileIntent,
  type TenantSecretEnvelope,
} from '@compartment/contracts';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { eq } from 'drizzle-orm';
import type { ApiApp } from '../src/app.types';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import {
  buildArtifacts,
  deploymentRuns,
  deployments,
  environmentResourceOutputVariableBindings,
  environmentVariableValues,
  projectServices,
  projectResources,
  resourceReconcileRuns,
  variableChangeEvents,
} from '../src/db/schema';
import {
  claimNextQueuedDeployment,
  createSourceArchive,
  injectDeployRequest,
  installCompartment,
  requireClaimedDeployment,
  requireTenantSecretEnvelope,
  setVariable,
} from './api-integration.harness';
import {
  cleanupApiIntegrationRuntime,
  cleanupApiIntegrationTempDirectory,
  configureApiRuntimeWithPublicIngress,
  createApiIntegrationApps,
  createApiIntegrationTestContext,
  resetApiIntegrationTempDirectory,
} from './api-app-test.harness';
import { useApiDatabaseTestHarness } from './api-db-test.harness';

type InvalidateEdgeAppAccessSessions = () => Promise<void>;
type SynchronizeEdgeAppAccessState = () => Promise<void>;

interface AppAccessEdgeServiceMocks {
  invalidateEdgeAppAccessSessions: Mock<InvalidateEdgeAppAccessSessions>;
  synchronizeEdgeAppAccessState: Mock<SynchronizeEdgeAppAccessState>;
}

interface InstalledDeployContext {
  installPayload: InstallResponse;
}

interface ParsedErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

const postgresPresetPasswordEnvName: string = 'POSTGRES_PASSWORD';

const appAccessEdgeServiceMocks: AppAccessEdgeServiceMocks = vi.hoisted(
  (): AppAccessEdgeServiceMocks => ({
    invalidateEdgeAppAccessSessions: vi.fn<InvalidateEdgeAppAccessSessions>(),
    synchronizeEdgeAppAccessState: vi.fn<SynchronizeEdgeAppAccessState>(),
  }),
);

vi.mock(
  '../src/services/app-access-edge.service',
  (): AppAccessEdgeServiceMocks => ({
    invalidateEdgeAppAccessSessions: appAccessEdgeServiceMocks.invalidateEdgeAppAccessSessions,
    synchronizeEdgeAppAccessState: appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState,
  }),
);

const {
  apiConfig: defaultApiConfig,
  databaseUrl: apiIntegrationDatabaseUrl,
  testTempDirectory,
} = createApiIntegrationTestContext(
  'api_integration_deploy_service_connections',
  'api-integration-deploy-service-connections',
);
let pool!: Pool;
let db!: Database;
let app!: ApiApp;
let systemApp!: ApiApp;
let hasInitializedApiIntegrationRuntime: boolean = false;

describe('API deploy descriptor service connections integration', (): void => {
  useApiDatabaseTestHarness(apiIntegrationDatabaseUrl);

  beforeEach(async (): Promise<void> => {
    appAccessEdgeServiceMocks.invalidateEdgeAppAccessSessions.mockReset();
    appAccessEdgeServiceMocks.invalidateEdgeAppAccessSessions.mockResolvedValue(undefined);
    appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockReset();
    appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockResolvedValue(undefined);
    await resetApiIntegrationTempDirectory(testTempDirectory);
    pool = createDatabasePool(apiIntegrationDatabaseUrl);
    db = createDatabase(pool);
    ({ app, systemApp } = await createApiIntegrationApps(defaultApiConfig, db, pool));
    configureApiRuntimeWithPublicIngress(defaultApiConfig, db);
    hasInitializedApiIntegrationRuntime = true;
  });

  afterAll(async (): Promise<void> => {
    await cleanupApiIntegrationTempDirectory(testTempDirectory);
  });

  afterEach(async (): Promise<void> => {
    vi.unstubAllGlobals();
    if (!hasInitializedApiIntegrationRuntime) {
      return;
    }

    hasInitializedApiIntegrationRuntime = false;
    await cleanupApiIntegrationRuntime(app, systemApp, pool);
  });

  it('queues a connected deployment without release before its resource is bootstrapped', async (): Promise<void> => {
    const context: InstalledDeployContext = await installDeployContext();

    const deployResponse: LightMyRequestResponse = await deployConnectionDescriptor(context.installPayload);

    expectSuccessfulDeploy(deployResponse);
    expect(await db.select().from(deploymentRuns)).toHaveLength(1);
    expect(await db.select().from(deployments)).toHaveLength(1);
    expect(await db.select().from(buildArtifacts)).toHaveLength(1);
    await expectDescriptorConnectionBinding();
  });

  it('rejects a release deployment connected to an unbootstrapped resource before queueing build work', async (): Promise<void> => {
    const context: InstalledDeployContext = await installDeployContext();
    const deployResponse: LightMyRequestResponse = await deployReleaseConnectionDescriptor(context.installPayload);

    expect(deployResponse.statusCode, deployResponse.body).toBe(409);
    const payload: ParsedErrorResponse = errorResponseSchema.parse(deployResponse.json());
    expect(payload.error.code).toBe('resource_not_bootstrapped');
    expect(payload.error.message).toBe(
      'Resource "db" is not bootstrapped. Run `compartment resource bootstrap --resource db` first, then redeploy.',
    );
    expect(await db.select().from(projectResources)).toEqual([
      expect.objectContaining({
        expectedClaimsJson: '[]',
        name: 'db',
      }),
    ]);
    expect(await db.select().from(deploymentRuns)).toHaveLength(0);
    expect(await db.select().from(deployments)).toHaveLength(0);
    expect(await db.select().from(buildArtifacts)).toHaveLength(0);
    expect(await db.select().from(environmentResourceOutputVariableBindings)).toHaveLength(0);
    await expectGeneratedPasswordStoredEncrypted();
  });

  it('rejects a release deployment connected to a stopped bootstrapped resource before queueing build work', async (): Promise<void> => {
    const context: InstalledDeployContext = await installDeployContext();
    expect((await deployReleaseConnectionDescriptor(context.installPayload)).statusCode).toBe(409);
    await markResourceBootstrapped('db');

    const deployResponse: LightMyRequestResponse = await deployReleaseConnectionDescriptor(context.installPayload);

    expect(deployResponse.statusCode, deployResponse.body).toBe(409);
    const payload: ParsedErrorResponse = errorResponseSchema.parse(deployResponse.json());
    expect(payload.error.code).toBe('resource_not_running');
    expect(payload.error.message).toBe(
      'Resource "db" is not running. Start it with `compartment resource start --resource db` before deploying, then redeploy.',
    );
    expect(await db.select().from(deploymentRuns)).toHaveLength(0);
    expect(await db.select().from(deployments)).toHaveLength(0);
    expect(await db.select().from(buildArtifacts)).toHaveLength(0);
  });

  it('queues a release deployment after its connected resource is bootstrapped and running', async (): Promise<void> => {
    const context: InstalledDeployContext = await installDeployContext();
    expect((await deployReleaseConnectionDescriptor(context.installPayload)).statusCode).toBe(409);
    await markResourceRunning('db');

    const deployResponse: LightMyRequestResponse = await deployReleaseConnectionDescriptor(context.installPayload);

    expectSuccessfulDeploy(deployResponse);
    expect(await db.select().from(deploymentRuns)).toHaveLength(1);
    expect(await db.select().from(deployments)).toHaveLength(1);
    expect(await db.select().from(buildArtifacts)).toHaveLength(1);
    await expectDescriptorConnectionBinding();
  });

  it('queues a deployment that declares but does not depend on an unbootstrapped resource', async (): Promise<void> => {
    const context: InstalledDeployContext = await installDeployContext();

    const deployResponse: LightMyRequestResponse = await deployPresetDescriptor(context.installPayload);

    expectSuccessfulDeploy(deployResponse);
    expect(await db.select().from(deploymentRuns)).toHaveLength(1);
    expect(await db.select().from(deployments)).toHaveLength(1);
    expect(await db.select().from(buildArtifacts)).toHaveLength(1);
  });

  it('does not publish a worker reconcile for an unchanged running resource on app redeploy', async (): Promise<void> => {
    const context: InstalledDeployContext = await installDeployContext();
    expectSuccessfulDeploy(await deployPresetDescriptor(context.installPayload));
    requireClaimedDeployment(await claimNextQueuedDeployment(app));
    await markResourceRunningWithSuccessfulReconcile('db');
    const reconcileRunsBefore: (typeof resourceReconcileRuns.$inferSelect)[] = await db
      .select()
      .from(resourceReconcileRuns);

    expectSuccessfulDeploy(await deployPresetDescriptor(context.installPayload));

    expect(await db.select().from(resourceReconcileRuns)).toEqual(reconcileRunsBefore);
    expect(await db.select().from(deployments)).toHaveLength(2);
  });

  it('publishes a retry when the latest ordinary reconcile failed before a newer bootstrap record', async (): Promise<void> => {
    const context: InstalledDeployContext = await installDeployContext();
    expectSuccessfulDeploy(await deployPresetDescriptor(context.installPayload));
    requireClaimedDeployment(await claimNextQueuedDeployment(app));
    await markResourceRunning('db');
    const [resource] = await db.select().from(projectResources).where(eq(projectResources.name, 'db')).limit(1);
    if (resource === undefined) {
      throw new Error('Expected resource db to exist.');
    }
    const succeededAt: Date = new Date();
    const intentJson: string = resourceReconcileIntentJson(resource);
    await db.insert(resourceReconcileRuns).values([
      {
        createdAt: succeededAt,
        expectedClaimsJson: resource.expectedClaimsJson,
        id: 'resource_operation_older_succeeded',
        intentJson,
        operationType: 'reconcile',
        phase: 'succeeded',
        projectResourceId: resource.id,
      },
      {
        createdAt: new Date(succeededAt.getTime() + 1),
        expectedClaimsJson: resource.expectedClaimsJson,
        failureMessage: 'replacement failed',
        id: 'resource_operation_newer_failed',
        intentJson,
        operationType: 'reconcile',
        phase: 'failed',
        projectResourceId: resource.id,
      },
      {
        createdAt: new Date(succeededAt.getTime() + 2),
        expectedClaimsJson: resource.expectedClaimsJson,
        id: 'resource_operation_newest_bootstrap',
        intentJson,
        operationType: 'bootstrap',
        phase: 'succeeded',
        projectResourceId: resource.id,
      },
    ]);
    const reconcileRunsBefore: (typeof resourceReconcileRuns.$inferSelect)[] = await db
      .select()
      .from(resourceReconcileRuns);

    expectSuccessfulDeploy(await deployPresetDescriptor(context.installPayload));

    const reconcileRunsAfter: (typeof resourceReconcileRuns.$inferSelect)[] = await db
      .select()
      .from(resourceReconcileRuns);
    expect(reconcileRunsAfter).toHaveLength(reconcileRunsBefore.length + 1);
    expect(
      reconcileRunsAfter.find((run): boolean => !reconcileRunsBefore.some((before): boolean => before.id === run.id)),
    ).toMatchObject({ operationType: 'reconcile', phase: 'reconcile-pending' });
  });

  it('rejects descriptor resource connections selected for build env', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const response: LightMyRequestResponse = await deployConnectionDescriptor(installPayload, ['DATABASE_URL']);

    expectInvalidDeployConfig(response, 'Resource outputs resolve at runtime');
    expect(await db.select().from(deployments)).toHaveLength(0);
    expect(await db.select().from(buildArtifacts)).toHaveLength(0);
    expect(await db.select().from(projectResources)).toHaveLength(0);
    expect(await db.select().from(environmentResourceOutputVariableBindings)).toHaveLength(0);
  });

  it('rejects descriptor resource connections that conflict with direct service variables', async (): Promise<void> => {
    const context: InstalledDeployContext = await installDeployContext();
    expectSuccessfulDeploy(await deployPresetDescriptor(context.installPayload));
    await setServiceDatabaseUrlLiteral(context.installPayload);

    const response: LightMyRequestResponse = await deployConnectionDescriptor(
      context.installPayload,
      [],
      './services/api-v2',
    );

    expectInvalidDeployConfig(response, 'conflicts with an existing direct service variable');
    expect(await db.select().from(deployments)).toHaveLength(1);
    expect(await db.select().from(environmentResourceOutputVariableBindings)).toHaveLength(0);
    expect(await readOnlyProjectServicePath()).toBe('./services/api');
  });

  it('rejects descriptor resource connections that drift from existing resource-output bindings', async (): Promise<void> => {
    const context: InstalledDeployContext = await installDeployContext();
    await setServiceDatabaseUrlFromHostOutput(context.installPayload);

    const response: LightMyRequestResponse = await deployConnectionDescriptor(context.installPayload);

    expectInvalidDeployConfig(response, 'conflicts with existing resource output binding "db.host"');
    expect(await db.select().from(deployments)).toHaveLength(0);
    expect(await db.select().from(projectResources)).toHaveLength(0);
    expect(await db.select().from(environmentVariableValues)).toEqual([]);
    await expectHostOutputBindingRemains();
  });

  it('removes descriptor-owned bindings when connections are removed from the descriptor', async (): Promise<void> => {
    const context: InstalledDeployContext = await installDeployContext();

    expectSuccessfulDeploy(await deployConnectionDescriptor(context.installPayload));
    await expectDescriptorConnectionBinding();
    requireClaimedDeployment(await claimNextQueuedDeployment(app));
    expectSuccessfulDeploy(await deployPresetDescriptor(context.installPayload));

    expect(await db.select().from(environmentResourceOutputVariableBindings)).toEqual([]);
  });

  it('allows removed descriptor-owned bindings to move to build env in the same deploy', async (): Promise<void> => {
    const context: InstalledDeployContext = await installDeployContext();

    expectSuccessfulDeploy(await deployConnectionDescriptor(context.installPayload));
    await expectDescriptorConnectionBinding();
    requireClaimedDeployment(await claimNextQueuedDeployment(app));
    await setEnvironmentDatabaseUrlLiteral(context.installPayload);

    expectSuccessfulDeploy(await deployBuildEnvDescriptor(context.installPayload));

    expect(await db.select().from(environmentResourceOutputVariableBindings)).toEqual([]);
    const databaseUrl: TenantSecretEnvelope = requireTenantSecretEnvelope(
      requireClaimedDeployment(await claimNextQueuedDeployment(app)).buildEnv,
      'DATABASE_URL',
    );
    expect(databaseUrl.encryptionKeyId).toMatch(/^tenant-kek-sha256:/);
    expect(databaseUrl.valueCiphertext).toBeTypeOf('string');
    expect(JSON.stringify(databaseUrl)).not.toContain('postgres://build-time');
  });
});

async function installDeployContext(): Promise<InstalledDeployContext> {
  const installPayload: InstallResponse = await installCompartment(app);

  return { installPayload };
}

async function deployConnectionDescriptor(
  installPayload: InstallResponse,
  buildEnv: readonly string[] = [],
  servicePath: string = './services/api',
): Promise<LightMyRequestResponse> {
  return await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev', {
    descriptor: createPostgresPresetConnectionDeployDescriptor(buildEnv, servicePath),
    sourceArchive: await createPostgresPresetDeploySourceArchive(),
  });
}

async function deployReleaseConnectionDescriptor(installPayload: InstallResponse): Promise<LightMyRequestResponse> {
  return await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev', {
    descriptor: createPostgresPresetReleaseConnectionDeployDescriptor(),
    sourceArchive: await createPostgresPresetDeploySourceArchive(),
  });
}

async function deployPresetDescriptor(installPayload: InstallResponse): Promise<LightMyRequestResponse> {
  return await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev', {
    descriptor: createPostgresPresetDeployDescriptor(),
    sourceArchive: await createPostgresPresetDeploySourceArchive(),
  });
}

async function deployBuildEnvDescriptor(installPayload: InstallResponse): Promise<LightMyRequestResponse> {
  return await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev', {
    descriptor: createPostgresPresetBuildEnvDeployDescriptor(),
    sourceArchive: await createPostgresPresetDeploySourceArchive(),
  });
}

function expectSuccessfulDeploy(response: LightMyRequestResponse): void {
  expect(response.statusCode, response.body).toBe(200);
}

function expectInvalidDeployConfig(response: LightMyRequestResponse, message: string): void {
  expect(response.statusCode, response.body).toBe(400);
  const payload: ParsedErrorResponse = errorResponseSchema.parse(response.json());
  expect(payload.error.code).toBe('invalid_deploy_config');
  expect(payload.error.message).toContain(message);
}

async function expectDescriptorConnectionBinding(): Promise<void> {
  expect(await db.select().from(environmentResourceOutputVariableBindings)).toEqual([
    expect.objectContaining({
      keyName: 'DATABASE_URL',
      outputName: 'connection-url',
      resourceName: 'db',
      source: 'descriptor',
      targetServiceName: 'api',
    }),
  ]);
}

async function expectGeneratedPasswordStoredEncrypted(): Promise<void> {
  const variableRows: (typeof environmentVariableValues.$inferSelect)[] = await db
    .select()
    .from(environmentVariableValues);
  expect(variableRows).toEqual([
    expect.objectContaining({
      keyName: postgresPresetPasswordEnvName,
      projectServiceId: null,
      sensitivity: 'sensitive',
      targetResourceName: 'db',
    }),
  ]);
  expect(variableRows[0]?.valueCiphertext).not.toBeNull();
  expect(JSON.stringify(await db.select().from(variableChangeEvents))).not.toContain('valueCiphertext');
}

async function markResourceBootstrapped(resourceName: string): Promise<void> {
  await db
    .update(projectResources)
    .set({
      expectedClaimsJson: JSON.stringify([{ claimName: 'data', uid: 'pvc-data' }]),
    })
    .where(eq(projectResources.name, resourceName));
}

async function markResourceRunning(resourceName: string): Promise<void> {
  await db
    .update(projectResources)
    .set({
      expectedClaimsJson: JSON.stringify([{ claimName: 'data', uid: 'pvc-data' }]),
      status: 'running',
    })
    .where(eq(projectResources.name, resourceName));
}

async function markResourceRunningWithSuccessfulReconcile(resourceName: string): Promise<void> {
  await markResourceRunning(resourceName);
  const [resource] = await db.select().from(projectResources).where(eq(projectResources.name, resourceName)).limit(1);
  if (resource === undefined) {
    throw new Error(`Expected resource ${resourceName} to exist.`);
  }
  await db.insert(resourceReconcileRuns).values({
    createdAt: new Date(),
    expectedClaimsJson: resource.expectedClaimsJson,
    id: 'resource_operation_succeeded',
    intentJson: resourceReconcileIntentJson(resource),
    operationType: 'reconcile',
    phase: 'succeeded',
    projectResourceId: resource.id,
  });
}

function resourceReconcileIntentJson(resource: typeof projectResources.$inferSelect): string {
  const intent: ResourceReconcileIntent = {
    command: JSON.parse(resource.commandJson) as string[],
    deleteData: false,
    environmentId: resource.environmentId,
    env: {},
    image: resource.image,
    namespaceId: 'project',
    operation: 'reconcile',
    ports: JSON.parse(resource.portsJson) as number[],
    readiness: JSON.parse(resource.readinessJson) as ResourceReadinessSummary | null,
    replicas: 1,
    resourceId: resource.id,
    secretId: resource.id,
    volumes: [],
  };
  return JSON.stringify(intent);
}

async function setServiceDatabaseUrlLiteral(installPayload: InstallResponse): Promise<void> {
  await setVariable(app, installPayload.sessionToken, 'acme-dev', {
    keyName: 'DATABASE_URL',
    projectName: 'smoke-web',
    serviceName: 'api',
    value: 'postgres://literal',
  });
}

async function setEnvironmentDatabaseUrlLiteral(installPayload: InstallResponse): Promise<void> {
  await setVariable(app, installPayload.sessionToken, 'acme-dev', {
    keyName: 'DATABASE_URL',
    projectName: 'smoke-web',
    value: 'postgres://build-time',
  });
}

async function setServiceDatabaseUrlFromHostOutput(installPayload: InstallResponse): Promise<void> {
  await setVariable(app, installPayload.sessionToken, 'acme-dev', {
    fromResource: 'db.host',
    keyName: 'DATABASE_URL',
    projectName: 'smoke-web',
    serviceName: 'api',
  });
}

async function expectHostOutputBindingRemains(): Promise<void> {
  expect(await db.select().from(environmentResourceOutputVariableBindings)).toEqual([
    expect.objectContaining({
      keyName: 'DATABASE_URL',
      outputName: 'host',
      resourceName: 'db',
      source: 'cli',
      targetServiceName: 'api',
    }),
  ]);
}

async function readOnlyProjectServicePath(): Promise<string> {
  const serviceRows: (typeof projectServices.$inferSelect)[] = await db.select().from(projectServices);
  expect(serviceRows).toHaveLength(1);

  return serviceRows[0]!.path;
}

function createPostgresPresetDeployDescriptor(): CompartmentAuthoredDescriptorInput {
  return {
    name: 'smoke-web',
    resources: {
      db: {
        preset: 'postgres',
      },
    },
    services: {
      api: './services/api',
    },
  };
}

function createPostgresPresetBuildEnvDeployDescriptor(): CompartmentAuthoredDescriptorInput {
  return {
    name: 'smoke-web',
    resources: {
      db: {
        preset: 'postgres',
      },
    },
    services: {
      api: {
        build: {
          env: ['DATABASE_URL'],
        },
        path: './services/api',
      },
    },
  };
}

function createPostgresPresetConnectionDeployDescriptor(
  buildEnv: readonly string[],
  servicePath: string,
): CompartmentAuthoredDescriptorInput {
  return {
    name: 'smoke-web',
    resources: {
      db: {
        preset: 'postgres',
      },
    },
    services: {
      api: {
        ...(buildEnv.length > 0 ? { build: { env: [...buildEnv] } } : {}),
        connections: {
          db: {
            env: {
              DATABASE_URL: 'connection-url',
            },
          },
        },
        path: servicePath,
      },
    },
  };
}

function createPostgresPresetReleaseConnectionDeployDescriptor(): CompartmentAuthoredDescriptorInput {
  const descriptor: CompartmentAuthoredDescriptorInput = createPostgresPresetConnectionDeployDescriptor(
    [],
    './services/api',
  );
  descriptor.services.api = {
    connections: {
      db: {
        env: {
          DATABASE_URL: 'connection-url',
        },
      },
    },
    path: './services/api',
    release: {
      command: 'pnpm db:migrate',
    },
  };
  return descriptor;
}

async function createPostgresPresetDeploySourceArchive(): Promise<Buffer> {
  return await createSourceArchive(
    {
      'compartment.yml': 'name: smoke-web\nservices:\n  api: ./services/api\nresources:\n  db:\n    preset: postgres\n',
      'services/api/package.json': '{"name":"api"}\n',
    },
    {
      descriptorDirectoryRelativePath: '.',
      version: 1,
    },
  );
}
