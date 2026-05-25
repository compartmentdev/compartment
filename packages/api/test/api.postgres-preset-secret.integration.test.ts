import {
  resourceOutputListResponseSchema,
  type CompartmentAuthoredDescriptorInput,
  type CompartmentResourceGeneratedVariableConfig,
  type InstallResponse,
  type WorkerClaimedDeployment,
} from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiApp } from '../src/app.types';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import { environmentVariableValues } from '../src/db/schema';
import {
  buildOrganizationAuthorizationHeaders,
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

interface ResourceRequestEnvInput {
  keyName: string;
  value: string;
}

interface ResourceRequestInput {
  definition: {
    env: ResourceRequestEnvInput[];
  };
}

interface AppAccessEdgeServiceMocks {
  invalidateEdgeAppAccessSessions: Mock<InvalidateEdgeAppAccessSessions>;
  synchronizeEdgeAppAccessState: Mock<SynchronizeEdgeAppAccessState>;
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
} = createApiIntegrationTestContext('api_integration_postgres_preset_secret', 'api-integration-postgres-preset-secret');
let pool!: Pool;
let db!: Database;
let app!: ApiApp;
let systemApp!: ApiApp;
let hasInitializedApiIntegrationRuntime: boolean = false;

describe('Phase 0 API integration postgres preset secrets', (): void => {
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

  it('uses descriptor-defined postgres preset secrets without storing generated variables', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await registerLocalNode(app);
    queueIntegrationNodeAgentResponse({
      containerId: 'resource_container_db',
      hostname: 'db.production.smoke-web.resource.internal',
      status: 'running',
    });

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        descriptor: createPostgresPresetDeployDescriptor(),
        sourceArchive: await createPostgresPresetDeploySourceArchive(),
      },
    );

    expect(deployResponse.statusCode, deployResponse.body).toBe(200);
    expect(readIntegrationNodeAgentRequestBody(0)).toContain('descriptor-secret-value');
    expect(await db.select().from(environmentVariableValues)).toHaveLength(0);
  });

  it('auto-generates declared resource variables before resolving resource outputs', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await registerLocalNode(app);
    await setVariable(app, installPayload.sessionToken, 'acme-dev', {
      fromResource: 'db.connection-url',
      keyName: 'DATABASE_URL',
      projectName: 'smoke-web',
      serviceName: 'api',
    });

    const deployResponse: LightMyRequestResponse = await deployGeneratedResource(installPayload, {
      bytes: 32,
      encoding: 'base64url',
      generator: 'token',
    });

    expect(deployResponse.statusCode, deployResponse.body).toBe(200);
    const generatedPassword: string = expectResourceRequestEnvValue(0, postgresPresetPasswordEnvName);
    expect(generatedPassword).toHaveLength(43);
    expect(generatedPassword).toMatch(/^[A-Za-z0-9_-]+$/u);
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

    const claimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(await claimNextQueuedDeployment(app));
    expect(claimedDeployment.runtimeEnv.DATABASE_URL).toBe(
      `postgres://app:${generatedPassword}@db.production.smoke-web.resource.internal:5432/app`,
    );

    const outputListResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      url: '/v1/resources/db/outputs?projectName=smoke-web',
    });
    expect(outputListResponse.statusCode).toBe(200);
    expect(JSON.stringify(resourceOutputListResponseSchema.parse(outputListResponse.json()))).not.toContain(
      generatedPassword,
    );
  });

  it('preserves existing generated resource variables during redeploy', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await registerLocalNode(app);
    await setVariable(app, installPayload.sessionToken, 'acme-dev', {
      fromResource: 'db.connection-url',
      keyName: 'DATABASE_URL',
      projectName: 'smoke-web',
      serviceName: 'api',
    });

    const firstDeployResponse: LightMyRequestResponse = await deployGeneratedResource(installPayload);

    expect(firstDeployResponse.statusCode, firstDeployResponse.body).toBe(200);
    const generatedPassword: string = expectResourceRequestEnvValue(0, postgresPresetPasswordEnvName);
    const firstClaimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(
      await claimNextQueuedDeployment(app),
    );
    expect(firstClaimedDeployment.runtimeEnv.DATABASE_URL).toBe(
      `postgres://app:${generatedPassword}@db.production.smoke-web.resource.internal:5432/app`,
    );
    const [firstVariableRow] = await db.select().from(environmentVariableValues);
    if (firstVariableRow === undefined) {
      throw new Error('Expected generated resource variable row.');
    }

    const secondDeployResponse: LightMyRequestResponse = await deployGeneratedResource(installPayload);

    expect(secondDeployResponse.statusCode, secondDeployResponse.body).toBe(200);
    expect(readIntegrationNodeAgentRequests()).toHaveLength(1);
    const secondClaimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(
      await claimNextQueuedDeployment(app),
    );
    expect(secondClaimedDeployment.runtimeEnv.DATABASE_URL).toBe(
      `postgres://app:${generatedPassword}@db.production.smoke-web.resource.internal:5432/app`,
    );
    expect(await db.select().from(environmentVariableValues)).toEqual([
      expect.objectContaining({
        id: firstVariableRow.id,
        valueFingerprint: firstVariableRow.valueFingerprint,
      }),
    ]);
    expect(JSON.stringify(await db.select().from(environmentVariableValues))).not.toContain(generatedPassword);
  });

  it('uses preexisting resource variables instead of generated resource variables', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await registerLocalNode(app);
    await setVariable(app, installPayload.sessionToken, 'acme-dev', {
      keyName: postgresPresetPasswordEnvName,
      projectName: 'smoke-web',
      resourceName: 'db',
      sensitivity: 'sensitive',
      value: 'custom-secret-password',
    });
    await setVariable(app, installPayload.sessionToken, 'acme-dev', {
      fromResource: 'db.connection-url',
      keyName: 'DATABASE_URL',
      projectName: 'smoke-web',
      serviceName: 'api',
    });

    const deployResponse: LightMyRequestResponse = await deployGeneratedResource(installPayload);

    expect(deployResponse.statusCode, deployResponse.body).toBe(200);
    expect(readIntegrationNodeAgentRequestBody(0)).toContain('custom-secret-password');
    const claimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(await claimNextQueuedDeployment(app));
    expect(claimedDeployment.runtimeEnv.DATABASE_URL).toBe(
      'postgres://app:custom-secret-password@db.production.smoke-web.resource.internal:5432/app',
    );
    expect(await db.select().from(environmentVariableValues)).toHaveLength(1);
  });
});

async function deployGeneratedResource(
  installPayload: InstallResponse,
  generatedVariableConfig: CompartmentResourceGeneratedVariableConfig = {
    generator: 'token',
  },
): Promise<LightMyRequestResponse> {
  return await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev', {
    descriptor: createGeneratedResourceDeployDescriptor(generatedVariableConfig),
    sourceArchive: await createPostgresPresetDeploySourceArchive(),
  });
}

function createGeneratedResourceDeployDescriptor(
  generatedVariableConfig: CompartmentResourceGeneratedVariableConfig,
): CompartmentAuthoredDescriptorInput {
  return {
    name: 'smoke-web',
    resources: {
      db: {
        env: {
          POSTGRES_DB: 'app',
          POSTGRES_USER: 'app',
        },
        generatedVariables: {
          [postgresPresetPasswordEnvName]: generatedVariableConfig,
        },
        image: 'postgres:16-alpine',
        outputs: {
          'connection-url': {
            sensitive: true,
            value: 'postgres://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@${resource.host}:5432/${env.POSTGRES_DB}',
          },
        },
        ports: [5432],
      },
    },
    services: {
      api: './services/api',
    },
  };
}

function createPostgresPresetDeployDescriptor(): CompartmentAuthoredDescriptorInput {
  return {
    name: 'smoke-web',
    resources: {
      db: {
        env: {
          [postgresPresetPasswordEnvName]: 'descriptor-secret-value',
        },
        preset: 'postgres',
      },
    },
    services: {
      api: './services/api',
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
