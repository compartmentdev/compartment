import type { LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';
import {
  errorResponseSchema,
  type CompartmentAuthoredDescriptorInput,
  type InstallResponse,
  type WorkerClaimedDeployment,
} from '@compartment/contracts';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiApp } from '../src/app.types';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import {
  buildArtifacts,
  deployments,
  environmentResourceOutputVariableBindings,
  environmentVariableValues,
  projectServices,
  projectResources,
  variableChangeEvents,
} from '../src/db/schema';
import {
  claimNextQueuedDeployment,
  createSourceArchive,
  injectDeployRequest,
  installCompartment,
  queueIntegrationNodeAgentResponse,
  registerLocalNode,
  readIntegrationNodeAgentRequestBody,
  readIntegrationNodeAgentRequests,
  requireClaimedDeployment,
  setVariable,
} from './api-integration.harness';
import {
  cleanupApiIntegrationRuntime,
  cleanupApiIntegrationTlsDirectory,
  configureApiRuntimeWithPublicIngress,
  createApiIntegrationApps,
  createApiIntegrationTestContext,
  resetApiIntegrationTlsDirectory,
} from './api-app-test.harness';
import { useApiDatabaseTestHarness } from './api-db-test.harness';

type InvalidateEdgeAppAccessSessions = () => Promise<void>;
type SynchronizeEdgeAppAccessState = () => Promise<void>;

interface AppAccessEdgeServiceMocks {
  invalidateEdgeAppAccessSessions: Mock<InvalidateEdgeAppAccessSessions>;
  synchronizeEdgeAppAccessState: Mock<SynchronizeEdgeAppAccessState>;
}

interface ResourceRequestEnvInput {
  keyName: string;
  value: string;
}

interface ResourceRequestInput {
  definition: {
    env: ResourceRequestEnvInput[];
  };
}

interface InstalledLocalNodeDeployContext {
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
  testCustomTlsDirectory,
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
    await resetApiIntegrationTlsDirectory(testCustomTlsDirectory);
    pool = createDatabasePool(apiIntegrationDatabaseUrl);
    db = createDatabase(pool);
    ({ app, systemApp } = await createApiIntegrationApps(defaultApiConfig, db, pool));
    configureApiRuntimeWithPublicIngress(defaultApiConfig, db);
    hasInitializedApiIntegrationRuntime = true;
  });

  afterAll(async (): Promise<void> => {
    await cleanupApiIntegrationTlsDirectory(testCustomTlsDirectory);
  });

  afterEach(async (): Promise<void> => {
    vi.unstubAllGlobals();
    if (!hasInitializedApiIntegrationRuntime) {
      return;
    }

    hasInitializedApiIntegrationRuntime = false;
    await cleanupApiIntegrationRuntime(app, systemApp, pool);
  });

  it('injects descriptor resource connections without manual resource-output variables', async (): Promise<void> => {
    const context: InstalledLocalNodeDeployContext = await installAndRegisterLocalNode();
    const deployResponse: LightMyRequestResponse = await deployConnectionDescriptor(context.installPayload);

    expect(deployResponse.statusCode, deployResponse.body).toBe(200);
    const generatedPassword: string = expectResourceRequestEnvValue(0, postgresPresetPasswordEnvName);
    await expectDescriptorConnectionBinding();
    await expectGeneratedPasswordStoredWithoutPlaintext(generatedPassword);
    await expectClaimedDatabaseUrl(generatedPassword);
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
    const context: InstalledLocalNodeDeployContext = await installAndRegisterLocalNode();
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
    const context: InstalledLocalNodeDeployContext = await installAndRegisterLocalNode();
    await setServiceDatabaseUrlFromHostOutput(context.installPayload);

    const response: LightMyRequestResponse = await deployConnectionDescriptor(context.installPayload);

    expectInvalidDeployConfig(response, 'conflicts with existing resource output binding "db.host"');
    expect(readIntegrationNodeAgentRequests()).toEqual([]);
    expect(await db.select().from(deployments)).toHaveLength(0);
    expect(await db.select().from(projectResources)).toHaveLength(0);
    expect(await db.select().from(environmentVariableValues)).toEqual([]);
    await expectHostOutputBindingRemains();
  });

  it('removes descriptor-owned bindings when connections are removed from the descriptor', async (): Promise<void> => {
    const context: InstalledLocalNodeDeployContext = await installAndRegisterLocalNode();

    expectSuccessfulDeploy(await deployConnectionDescriptor(context.installPayload));
    await expectDescriptorConnectionBinding();
    requireClaimedDeployment(await claimNextQueuedDeployment(app));
    expectSuccessfulDeploy(await deployPresetDescriptor(context.installPayload));

    expect(await db.select().from(environmentResourceOutputVariableBindings)).toEqual([]);
    expect(requireClaimedDeployment(await claimNextQueuedDeployment(app)).runtimeEnv).not.toHaveProperty(
      'DATABASE_URL',
    );
  });

  it('allows removed descriptor-owned bindings to move to build env in the same deploy', async (): Promise<void> => {
    const context: InstalledLocalNodeDeployContext = await installAndRegisterLocalNode();

    expectSuccessfulDeploy(await deployConnectionDescriptor(context.installPayload));
    await expectDescriptorConnectionBinding();
    requireClaimedDeployment(await claimNextQueuedDeployment(app));
    await setEnvironmentDatabaseUrlLiteral(context.installPayload);

    expectSuccessfulDeploy(await deployBuildEnvDescriptor(context.installPayload));

    expect(await db.select().from(environmentResourceOutputVariableBindings)).toEqual([]);
    expect(requireClaimedDeployment(await claimNextQueuedDeployment(app)).buildEnv).toEqual({
      DATABASE_URL: 'postgres://build-time',
    });
  });
});

async function installAndRegisterLocalNode(): Promise<InstalledLocalNodeDeployContext> {
  const installPayload: InstallResponse = await installCompartment(app);
  await registerLocalNode(app);
  queueIntegrationNodeAgentResponse({
    containerId: 'resource_container_db',
    hostname: 'db.production.smoke-web.resource.internal',
    status: 'running',
  });

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

function expectResourceRequestEnvValue(callIndex: number, keyName: string): string {
  const resourceRequest: ResourceRequestInput = JSON.parse(
    readIntegrationNodeAgentRequestBody(callIndex),
  ) as ResourceRequestInput;
  const value: string | undefined = resourceRequest.definition.env.find(
    (env: ResourceRequestEnvInput): boolean => env.keyName === keyName,
  )?.value;
  if (value === undefined) {
    throw new Error(`Expected resource request env "${keyName}".`);
  }

  return value;
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

async function expectGeneratedPasswordStoredWithoutPlaintext(generatedPassword: string): Promise<void> {
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
  expect(JSON.stringify(variableRows)).not.toContain(generatedPassword);
  expect(JSON.stringify(await db.select().from(variableChangeEvents))).not.toContain(generatedPassword);
}

async function expectClaimedDatabaseUrl(generatedPassword: string): Promise<void> {
  const claimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(await claimNextQueuedDeployment(app));
  expect(claimedDeployment.runtimeEnv.DATABASE_URL).toBe(
    `postgres://app:${generatedPassword}@db.production.smoke-web.resource.internal:5432/app`,
  );
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
