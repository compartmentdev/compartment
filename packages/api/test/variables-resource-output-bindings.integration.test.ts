import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';
import {
  compartmentCurrentOrganizationHeaderName,
  compartmentAuthoredDescriptorSchema,
  type CompartmentAuthoredResourceConfig,
  type ImportVariablesRequest,
  type InstallResponse,
  type VariableListItem,
  type VariableListResponse,
  type VariableLocalRunRequest,
  type VariableLocalRunResponse,
  type VariableResponse,
  variableListResponseSchema,
  variableLocalRunResponseSchema,
  variableResponseSchema,
} from '@compartment/contracts';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '@compartment/test-support';
import { kubeResourceServiceDns } from '@compartment/utils';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import type { ApiApp } from '../src/app.types';
import { type ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import {
  environmentResourceOutputVariableBindings,
  environmentVariableValues,
  environments,
  projectResources,
  projects,
  variableAccessEvents,
} from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { createSourceArchive, injectDeployRequest, installCompartment, setVariable } from './api-integration.harness';
import { useApiDatabaseTestHarness } from './api-db-test.harness';
import { expectJsonError } from './api-route-test.harness';

interface AppAccessEdgeServiceModule {
  invalidateEdgeAppAccessSessions: () => Promise<void>;
  synchronizeEdgeAppAccessState: () => Promise<void>;
}

interface ResourceBindingTarget {
  environmentId: string;
  namespaceId: string;
}

interface VariableRequestOptions {
  headers: Record<string, string>;
  method: 'GET' | 'POST';
  url: string;
}

vi.mock(
  '../src/services/app-access-edge.service',
  (): AppAccessEdgeServiceModule => ({
    invalidateEdgeAppAccessSessions: async (): Promise<void> => await Promise.resolve(),
    synchronizeEdgeAppAccessState: async (): Promise<void> => await Promise.resolve(),
  }),
);

const { testDatabaseUrl } = readDatabaseTestMode();
const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'api_variable_resource_output_bindings');
const apiConfig: ApiConfig = {
  auditFileSink: defaultAuditFileSinkConfig,
  auditRetentionCleanupBatchSize: 1000,
  auditRetentionCleanupCron: '0 3 * * *',
  auditRetentionCleanupMaxBatches: 100,
  usageMeteringIntervalMs: 60_000,
  usageRetentionDays: 400,
  auditRetentionDays: 90,
  baseDomain: 'localhost',
  bindHost: '127.0.0.1',
  tlsMode: 'internal',
  controlPlaneHost: 'console.localhost',
  databaseUrl,
  edgeToken: 'test-edge-token',
  edgeUrl: 'http://127.0.0.1:9081',
  logLevel: 'silent',
  port: 9444,
  publicHttpPort: 80,
  publicHttpsPort: 443,
  publicProtocol: 'http',
  rollbackRetentionLimit: null,
  runtimeControlToken: 'test-runtime-control-token',
  sessionSecret: 'test-secret',
  sessionTtlMs: 604_800_000,
  signupEnabled: false,
  sourceArchiveDirectory: join(tmpdir(), 'compartment-api-variable-resource-output-archives'),
  sourceArchiveMaxBytes: 104_857_600,
  systemApiSocketPath: '/tmp/compartment/compartment-variable-resource-output-system-api.sock',
  systemToken: 'test-system-token',
  throttle: defaultApiAuthThrottleConfig,
  trustedOutboundHosts: [],
  tenantSecretsKek: parseVariablesMasterKey('11'.repeat(32)),
  variablesMasterKey: parseVariablesMasterKey('11'.repeat(32)),
};
const pool: Pool = createDatabasePool(databaseUrl);
const db: Database = createDatabase(pool);
const app: ApiApp = createApp({ config: apiConfig, pool });

describe('variable resource-output binding integration', (): void => {
  useApiDatabaseTestHarness(databaseUrl);

  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  afterAll(async (): Promise<void> => {
    await app.close();
  });

  it('returns metadata, lists inventory, and rejects import over resource-output bindings', async (): Promise<void> => {
    const installPayload: InstallResponse = await installAndRegisterNode();
    await deployWebService(installPayload);
    const resourceHost: string = await insertProjectResource({
      outputsJson: JSON.stringify({
        host: { sensitive: false, value: '${resource.host}' },
        'secret-url': { sensitive: true, value: 'postgres://${resource.host}/secret' },
      }),
    });

    const plainPayload: VariableResponse = await setVariable(app, installPayload.sessionToken, 'acme-dev', {
      fromResource: 'postgres.host',
      keyName: 'POSTGRES_HOST',
      projectName: 'billing',
      serviceName: 'web',
    });
    const sensitivePayload: VariableResponse = await setVariable(app, installPayload.sessionToken, 'acme-dev', {
      fromResource: 'postgres.secret-url',
      keyName: 'DATABASE_URL',
      projectName: 'billing',
      serviceName: 'web',
    });

    expect(plainPayload.variable).toEqual(
      expect.objectContaining({
        keyName: 'POSTGRES_HOST',
        sensitivity: 'plain',
        sourceResourceOutput: 'postgres.host',
        value: null,
        valueHidden: true,
      }),
    );
    expect(sensitivePayload.variable).toEqual(
      expect.objectContaining({
        keyName: 'DATABASE_URL',
        sensitivity: 'sensitive',
        sourceResourceOutput: 'postgres.secret-url',
        value: null,
        valueHidden: true,
      }),
    );
    expect(
      (
        await showVariableByKey(installPayload, 'POSTGRES_HOST', {
          projectName: 'billing',
          serviceName: 'web',
        })
      ).variable,
    ).toEqual(
      expect.objectContaining({
        keyName: 'POSTGRES_HOST',
        sensitivity: 'plain',
        sourceResourceOutput: 'postgres.host',
        value: resourceHost,
        valueHidden: false,
      }),
    );
    expect(readVariableByKey(await listVariables(installPayload, { projectName: 'billing' }), 'DATABASE_URL')).toEqual(
      expect.objectContaining({
        scopeServiceName: 'web',
        sourceResourceOutput: 'postgres.secret-url',
        sourceType: 'resource_output',
      }),
    );

    const response: LightMyRequestResponse = await injectVariablesRequest(
      installPayload,
      'POST',
      '/v1/variables/import',
      {
        entries: [{ keyName: 'DATABASE_URL', value: 'postgres://literal' }],
        projectName: 'billing',
        replace: true,
        serviceName: 'web',
      },
    );

    expectJsonError(response, 409, 'variable_collision');
    expect(response.body).toContain('would overwrite resource output bindings');
    expect(await db.select().from(environmentVariableValues)).toEqual([]);
    expect(await db.select().from(environmentResourceOutputVariableBindings)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keyName: 'DATABASE_URL',
          outputName: 'secret-url',
          resourceName: 'postgres',
          targetServiceName: 'web',
        }),
      ]),
    );
  });

  it('injects resource-output bindings during local-run without persisting plaintext in audit', async (): Promise<void> => {
    const installPayload: InstallResponse = await installAndRegisterNode();
    await deployWebService(installPayload);
    const resource: CompartmentAuthoredResourceConfig = createPostgresPresetResource();
    const postgresDatabase: string = readRequiredResourceEnv(resource, 'POSTGRES_DB');
    const postgresUser: string = readRequiredResourceEnv(resource, 'POSTGRES_USER');
    const resourceHost: string = await insertProjectResource({
      envJson: JSON.stringify([
        { keyName: 'POSTGRES_DB', literalValue: postgresDatabase, sourceType: 'literal', variableName: null },
        {
          keyName: 'POSTGRES_USER',
          literalValue: postgresUser,
          sourceType: 'literal',
          variableName: null,
        },
      ]),
      image: resource.image,
      operationsJson: JSON.stringify(resource.operations ?? {}),
      outputsJson: JSON.stringify(resource.outputs ?? {}),
      portsJson: JSON.stringify(resource.ports ?? []),
      readinessJson: JSON.stringify(resource.readiness ?? null),
      volumesJson: JSON.stringify([{ mountPath: '/var/lib/postgresql/data', name: 'data' }]),
    });
    await setVariable(app, installPayload.sessionToken, 'acme-dev', {
      keyName: 'POSTGRES_PASSWORD',
      projectName: 'billing',
      resourceName: 'postgres',
      sensitivity: 'sensitive',
      value: 'resource-secret',
    });
    await setVariable(app, installPayload.sessionToken, 'acme-dev', {
      fromResource: 'postgres.connection-url',
      keyName: 'DATABASE_URL',
      projectName: 'billing',
      serviceName: 'web',
    });

    const localRunPayload: VariableLocalRunResponse = await loadVariablesForLocalRun(installPayload, {
      commandName: 'node',
      environmentName: 'production',
      productionAck: true,
      projectName: 'billing',
      serviceName: 'web',
    });
    const auditRows: (typeof variableAccessEvents.$inferSelect)[] = await db.select().from(variableAccessEvents);

    expect(localRunPayload.variables).toEqual([
      expect.objectContaining({
        keyName: 'DATABASE_URL',
        sensitivity: 'sensitive',
        sourceResourceOutput: 'postgres.connection-url',
        sourceType: 'resource_output',
        value: `postgres://app:resource-secret@${resourceHost}:5432/app`,
      }),
    ]);
    expect(auditRows).toHaveLength(1);
    expect(JSON.parse(auditRows[0]!.sensitivityJson)).toEqual({ DATABASE_URL: 'sensitive' });
    expect(Object.keys(JSON.parse(auditRows[0]!.fingerprintsJson) as Record<string, string>)).toEqual(['DATABASE_URL']);
    expect(JSON.stringify(auditRows)).not.toContain('resource-secret');
    expect(JSON.stringify(auditRows)).not.toContain('postgres://');
  });
});

async function installAndRegisterNode(): Promise<InstallResponse> {
  const installPayload: InstallResponse = await installCompartment(app);
  return installPayload;
}

function createPostgresPresetResource(): CompartmentAuthoredResourceConfig {
  const resource: CompartmentAuthoredResourceConfig | undefined = compartmentAuthoredDescriptorSchema.parse({
    name: 'billing',
    resources: {
      postgres: {
        preset: 'postgres',
      },
    },
    services: {
      web: '.',
    },
  }).resources?.postgres;
  if (resource === undefined) {
    throw new Error('Expected postgres preset resource.');
  }

  return resource;
}

function readRequiredResourceEnv(resource: CompartmentAuthoredResourceConfig, keyName: string): string {
  const value: string | undefined = resource.env?.[keyName];
  if (value === undefined) {
    throw new Error(`Expected postgres preset ${keyName} env.`);
  }

  return value;
}

async function deployWebService(installPayload: InstallResponse): Promise<void> {
  const response: LightMyRequestResponse = await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev', {
    descriptor: { name: 'billing', services: { web: '.' } },
    sourceArchive: await createSourceArchive({
      'compartment.yml': 'name: billing\nservices:\n  web: .\n',
      'package.json': '{"name":"billing-web"}\n',
    }),
  });

  expect(response.statusCode).toBe(200);
}

async function insertProjectResource(overrides: Partial<typeof projectResources.$inferInsert> = {}): Promise<string> {
  const target: ResourceBindingTarget = await readResourceBindingTarget();

  await db.insert(projectResources).values({
    commandJson: '[]',
    envJson: '[]',
    environmentId: target.environmentId,
    id: 'res_postgres',
    image: 'postgres:16',
    name: 'postgres',
    outputsJson: '{}',
    portsJson: '[5432]',
    readinessJson: '{"type":"tcp","port":5432,"timeoutMs":30000}',
    runtimeDefinitionHash: 'hash_postgres',
    status: 'running',
    volumesJson: '[]',
    ...overrides,
  });
  return kubeResourceServiceDns('res_postgres', target.namespaceId);
}

async function readResourceBindingTarget(): Promise<ResourceBindingTarget> {
  const project: typeof projects.$inferSelect = readRequiredFixtureRow(
    (await db.select().from(projects)).find((row: typeof projects.$inferSelect): boolean => row.name === 'billing'),
    'billing project',
  );
  const environment: typeof environments.$inferSelect = readRequiredFixtureRow(
    (await db.select().from(environments)).find(
      (row: typeof environments.$inferSelect): boolean => row.projectId === project.id && row.name === 'production',
    ),
    'production environment',
  );

  return { environmentId: environment.id, namespaceId: project.id };
}

function readRequiredFixtureRow<T>(row: T | undefined, label: string): T {
  if (row === undefined) {
    throw new Error(`Expected ${label} fixture row.`);
  }
  return row;
}

function readVariableByKey(payload: VariableListResponse, keyName: string): VariableListItem | undefined {
  return payload.variables.find((variable: VariableListItem): boolean => variable.keyName === keyName);
}

async function listVariables(
  installPayload: InstallResponse,
  query: Record<string, string>,
): Promise<VariableListResponse> {
  const response: LightMyRequestResponse = await injectVariablesRequest(
    installPayload,
    'GET',
    buildVariablePath('/v1/variables', query),
  );
  expect(response.statusCode).toBe(200);
  return variableListResponseSchema.parse(response.json());
}

async function showVariableByKey(
  installPayload: InstallResponse,
  keyName: string,
  query: Record<string, string>,
): Promise<VariableResponse> {
  const response: LightMyRequestResponse = await injectVariablesRequest(
    installPayload,
    'GET',
    buildVariablePath(`/v1/variables/${encodeURIComponent(keyName)}`, query),
  );
  expect(response.statusCode).toBe(200);
  return variableResponseSchema.parse(response.json());
}

async function loadVariablesForLocalRun(
  installPayload: InstallResponse,
  payload: VariableLocalRunRequest,
): Promise<VariableLocalRunResponse> {
  const response: LightMyRequestResponse = await injectVariablesRequest(
    installPayload,
    'POST',
    '/v1/variables/local-run',
    payload,
  );
  expect(response.statusCode).toBe(200);
  return variableLocalRunResponseSchema.parse(response.json());
}

async function injectVariablesRequest(
  installPayload: InstallResponse,
  method: 'GET' | 'POST',
  url: string,
  payload?: ImportVariablesRequest | VariableLocalRunRequest,
): Promise<LightMyRequestResponse> {
  const request: VariableRequestOptions = {
    headers: {
      authorization: `Bearer ${installPayload.sessionToken}`,
      [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
    },
    method,
    url,
  };

  return await app.inject(payload === undefined ? request : { ...request, payload });
}

function buildVariablePath(basePath: string, query: Record<string, string>): string {
  const searchParams: URLSearchParams = new URLSearchParams(query);
  return `${basePath}?${searchParams.toString()}`;
}
