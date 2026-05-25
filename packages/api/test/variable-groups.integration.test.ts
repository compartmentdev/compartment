import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';
import {
  captureVariableGroupResponseSchema,
  compartmentCurrentOrganizationHeaderName,
  importVariableGroupResponseSchema,
  variableGroupBindingResponseSchema,
  variableGroupListResponseSchema,
  variableGroupResponseSchema,
  variableGroupUsagesResponseSchema,
  variableResponseSchema,
  type CaptureVariableGroupRequest,
  type CaptureVariableGroupResponse,
  type CreateVariableGroupRequest,
  type ImportVariableGroupRequest,
  type ImportVariableGroupResponse,
  type InstallResponse,
  type PutVariableGroupVariableRequest,
  type SetVariableRequest,
  type VariableGroupBindingResponse,
  type VariableGroupListResponse,
  type VariableGroupResponse,
  type VariableGroupUsagesResponse,
  type VariableResponse,
} from '@compartment/contracts';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '@compartment/test-support';
import { createApp } from '../src/app';
import type { ApiApp } from '../src/app.types';
import { type ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import { organizationVariableSetEntries, organizationVariableSets, projects } from '../src/db/schema';
import { decryptVariableValueFromStorage, parseVariablesMasterKey } from '../src/lib/variables-crypto';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import { useApiDatabaseTestHarness } from './api-db-test.harness';
import {
  createSourceArchive,
  injectDeployRequest,
  installCompartment,
  registerLocalNode,
} from './api-integration.harness';
import { expectJsonError } from './api-route-test.harness';

interface AppAccessEdgeServiceModule {
  invalidateEdgeAppAccessSessions: () => Promise<void>;
  synchronizeEdgeAppAccessState: () => Promise<void>;
}

vi.mock(
  '../src/services/app-access-edge.service',
  (): AppAccessEdgeServiceModule => ({
    invalidateEdgeAppAccessSessions: async (): Promise<void> => await Promise.resolve(),
    synchronizeEdgeAppAccessState: async (): Promise<void> => await Promise.resolve(),
  }),
);

const { testDatabaseUrl } = readDatabaseTestMode();
const variableGroupsDatabaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'api_variable_groups_routes');
const apiConfig: ApiConfig = {
  bindHost: '127.0.0.1',
  baseDomain: 'localhost',
  caddyTlsMode: 'internal',
  customTlsDirectory: '/etc/compartment/tls',
  controlPlaneHost: 'console.localhost',
  databaseUrl: variableGroupsDatabaseUrl,
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
  publicHttpPort: 80,
  publicHttpsPort: 443,
  resourceBackupDirectory: join(tmpdir(), 'compartment-api-variable-groups-resource-backups'),
  sessionSecret: 'test-secret',
  sessionTtlMs: 604_800_000,
  sourceArchiveDirectory: join(tmpdir(), 'compartment-api-variable-groups-source-archives'),
  sourceArchiveMaxBytes: 104_857_600,
  throttle: defaultApiAuthThrottleConfig,
  runtimeControlToken: 'test-runtime-control-token',
  runtimeDefaultUpstreamHost: '127.0.0.1',
  nodeAgentSocketPath: '/tmp/compartment/api-test/node/integration.sock',
  systemApiSocketPath: '/tmp/compartment/compartment-variable-groups-system-api.sock',
  systemToken: 'test-system-token',
  trustedOutboundHosts: [],
  variablesMasterKey: parseVariablesMasterKey('11'.repeat(32)),
};
const pool: Pool = createDatabasePool(variableGroupsDatabaseUrl);
const db: Database = createDatabase(pool);
const app: ApiApp = createApp({ config: apiConfig, pool });

describe('variable groups integration', (): void => {
  useApiDatabaseTestHarness(variableGroupsDatabaseUrl);

  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  afterAll(async (): Promise<void> => {
    await app.close();
  });

  it('creates, imports, lists, and shows variable groups', async (): Promise<void> => {
    const installPayload: InstallResponse = await installAndRegisterNode();

    const createPayload: VariableGroupResponse = await createVariableGroup(installPayload, {
      variableGroupName: 'postgres-prod',
    });
    expect(createPayload.variableGroup.name).toBe('postgres-prod');
    expect(createPayload.variableGroup.variableCount).toBe(0);

    const putPayload: VariableGroupResponse = await putVariableGroupVariable(installPayload, {
      keyName: 'DATABASE_URL',
      sensitivity: 'sensitive',
      value: 'postgres://shared',
      variableGroupName: 'postgres-prod',
    });
    expect(putPayload.variableGroup.variables).toEqual([
      expect.objectContaining({
        keyName: 'DATABASE_URL',
        sensitivity: 'sensitive',
      }),
    ]);

    const importPayload: ImportVariableGroupResponse = await importVariableGroup(installPayload, {
      entries: [{ keyName: 'DB_SSLMODE', value: 'require' }],
      variableGroupName: 'postgres-prod',
    });
    expect(importPayload.importedKeyNames).toEqual(['DB_SSLMODE']);

    const listPayload: VariableGroupListResponse = await listVariableGroups(installPayload);
    expect(listPayload.variableGroups).toEqual([
      expect.objectContaining({
        name: 'postgres-prod',
        variableCount: 2,
      }),
    ]);

    const showPayload: VariableGroupResponse = await showVariableGroup(installPayload, 'postgres-prod');
    expect(showPayload.variableGroup.variables).toEqual([
      expect.objectContaining({ keyName: 'DATABASE_URL', sensitivity: 'sensitive' }),
      expect.objectContaining({ keyName: 'DB_SSLMODE', sensitivity: 'plain' }),
    ]);
  });

  it('captures only environment-scoped direct rows by default', async (): Promise<void> => {
    const installPayload: InstallResponse = await installAndRegisterNode();
    await deployWebService(installPayload);

    await setVariable(installPayload, {
      keyName: 'LOG_LEVEL',
      projectName: 'billing',
      value: 'info',
    });
    await setVariable(installPayload, {
      keyName: 'QUEUE_TOKEN',
      projectName: 'billing',
      serviceName: 'web',
      value: 'service-only',
    });

    const capturePayload: CaptureVariableGroupResponse = await captureVariableGroup(installPayload, {
      projectName: 'billing',
      variableGroupName: 'runtime-prod',
    });

    expect(capturePayload.capturedKeyNames).toEqual(['LOG_LEVEL']);
    expect(capturePayload.variableGroup.variables).toEqual([
      expect.objectContaining({
        keyName: 'LOG_LEVEL',
      }),
    ]);
  });

  it('captures effective winner values for service targets when requested', async (): Promise<void> => {
    const installPayload: InstallResponse = await installAndRegisterNode();
    await deployWebService(installPayload);

    await createVariableGroup(installPayload, {
      variableGroupName: 'shared-runtime',
    });
    await putVariableGroupVariable(installPayload, {
      keyName: 'API_TOKEN',
      value: 'group-token',
      variableGroupName: 'shared-runtime',
    });
    await bindVariableGroup(installPayload, 'shared-runtime', {
      projectName: 'billing',
    });
    await setVariable(installPayload, {
      keyName: 'DATABASE_URL',
      projectName: 'billing',
      value: 'postgres://shared',
    });
    await setVariable(installPayload, {
      keyName: 'LOG_LEVEL',
      projectName: 'billing',
      value: 'info',
    });
    await setVariable(installPayload, {
      keyName: 'LOG_LEVEL',
      projectName: 'billing',
      serviceName: 'web',
      value: 'debug',
    });

    const capturePayload: CaptureVariableGroupResponse = await captureVariableGroup(installPayload, {
      effective: true,
      projectName: 'billing',
      serviceName: 'web',
      variableGroupName: 'web-runtime',
    });

    expect([...capturePayload.capturedKeyNames].sort(compareText)).toEqual(['API_TOKEN', 'DATABASE_URL', 'LOG_LEVEL']);
    expect(await readStoredVariableGroupValues('web-runtime')).toEqual({
      API_TOKEN: 'group-token',
      DATABASE_URL: 'postgres://shared',
      LOG_LEVEL: 'debug',
    });
  });

  it('binds variable groups and reports usages on the selected target', async (): Promise<void> => {
    const installPayload: InstallResponse = await installAndRegisterNode();

    await createVariableGroup(installPayload, {
      variableGroupName: 'postgres-prod',
    });
    await putVariableGroupVariable(installPayload, {
      keyName: 'DATABASE_URL',
      sensitivity: 'sensitive',
      value: 'postgres://bound',
      variableGroupName: 'postgres-prod',
    });

    const bindPayload: VariableGroupBindingResponse = await bindVariableGroup(installPayload, 'postgres-prod', {
      projectName: 'billing',
    });
    expect(bindPayload.variableGroupName).toBe('postgres-prod');

    const usagesPayload: VariableGroupUsagesResponse = await listVariableGroupUsages(installPayload, 'postgres-prod');
    expect(usagesPayload.usages).toEqual([
      expect.objectContaining({
        environmentName: 'production',
        projectName: 'billing',
        serviceName: null,
      }),
    ]);

    const showPayload: VariableResponse = await showVariable(installPayload, 'DATABASE_URL', {
      projectName: 'billing',
    });
    expect(showPayload.variable).toEqual(
      expect.objectContaining({
        keyName: 'DATABASE_URL',
        sourceType: 'set',
        sourceVariableSetName: 'postgres-prod',
      }),
    );
  });

  it('treats rebinding the same group on the same target as idempotent', async (): Promise<void> => {
    const installPayload: InstallResponse = await installAndRegisterNode();

    await createVariableGroup(installPayload, {
      variableGroupName: 'postgres-prod',
    });
    await putVariableGroupVariable(installPayload, {
      keyName: 'DATABASE_URL',
      value: 'postgres://bound',
      variableGroupName: 'postgres-prod',
    });

    await bindVariableGroup(installPayload, 'postgres-prod', {
      projectName: 'billing',
    });
    const secondBindPayload: VariableGroupBindingResponse = await bindVariableGroup(installPayload, 'postgres-prod', {
      projectName: 'billing',
    });
    const usagesPayload: VariableGroupUsagesResponse = await listVariableGroupUsages(installPayload, 'postgres-prod');

    expect(secondBindPayload.variableGroupName).toBe('postgres-prod');
    expect(usagesPayload.usages).toEqual([
      expect.objectContaining({
        environmentName: 'production',
        projectName: 'billing',
        serviceName: null,
      }),
    ]);
  });

  it('unbinds variable groups and removes their winners from the selected target', async (): Promise<void> => {
    const installPayload: InstallResponse = await installAndRegisterNode();

    await createVariableGroup(installPayload, {
      variableGroupName: 'postgres-prod',
    });
    await putVariableGroupVariable(installPayload, {
      keyName: 'DATABASE_URL',
      value: 'postgres://bound',
      variableGroupName: 'postgres-prod',
    });
    await bindVariableGroup(installPayload, 'postgres-prod', {
      projectName: 'billing',
    });

    const unbindPayload: VariableGroupBindingResponse = await unbindVariableGroup(installPayload, 'postgres-prod', {
      projectName: 'billing',
    });
    const usagesPayload: VariableGroupUsagesResponse = await listVariableGroupUsages(installPayload, 'postgres-prod');
    const showResponse: LightMyRequestResponse = await injectVariablesRequest(
      installPayload,
      'GET',
      buildVariablePath('/v1/variables/DATABASE_URL', { projectName: 'billing' }),
    );

    expect(unbindPayload.variableGroupName).toBe('postgres-prod');
    expect(usagesPayload.usages).toEqual([]);
    expectJsonError(showResponse, 404, 'variable_not_found');
  });

  it('rejects same-scope variable group binding collisions', async (): Promise<void> => {
    const installPayload: InstallResponse = await installAndRegisterNode();

    await createVariableGroup(installPayload, {
      variableGroupName: 'first-group',
    });
    await putVariableGroupVariable(installPayload, {
      keyName: 'DATABASE_URL',
      value: 'postgres://one',
      variableGroupName: 'first-group',
    });
    await createVariableGroup(installPayload, {
      variableGroupName: 'second-group',
    });
    await putVariableGroupVariable(installPayload, {
      keyName: 'DATABASE_URL',
      value: 'postgres://two',
      variableGroupName: 'second-group',
    });

    await bindVariableGroup(installPayload, 'first-group', {
      projectName: 'billing',
    });

    const response: LightMyRequestResponse = await injectVariablesRequest(
      installPayload,
      'POST',
      buildVariablePath('/v1/variables/bindings/second-group', { projectName: 'billing' }),
    );

    expectJsonError(response, 409, 'variable_collision');
  });

  it('rejects group put collisions against already bound same-scope groups', async (): Promise<void> => {
    const installPayload: InstallResponse = await installAndRegisterNode();

    await createVariableGroup(installPayload, {
      variableGroupName: 'first-group',
    });
    await putVariableGroupVariable(installPayload, {
      keyName: 'DATABASE_URL',
      value: 'postgres://one',
      variableGroupName: 'first-group',
    });
    await createVariableGroup(installPayload, {
      variableGroupName: 'second-group',
    });
    await bindVariableGroup(installPayload, 'first-group', {
      projectName: 'billing',
    });
    await bindVariableGroup(installPayload, 'second-group', {
      projectName: 'billing',
    });

    const response: LightMyRequestResponse = await injectVariablesRequest(
      installPayload,
      'POST',
      '/v1/variable-groups/variables',
      {
        keyName: 'DATABASE_URL',
        value: 'postgres://two',
        variableGroupName: 'second-group',
      },
    );

    expectJsonError(response, 409, 'variable_collision');
  });

  it('rejects group import collisions against already bound same-scope groups', async (): Promise<void> => {
    const installPayload: InstallResponse = await installAndRegisterNode();

    await createVariableGroup(installPayload, {
      variableGroupName: 'first-group',
    });
    await putVariableGroupVariable(installPayload, {
      keyName: 'DATABASE_URL',
      value: 'postgres://one',
      variableGroupName: 'first-group',
    });
    await createVariableGroup(installPayload, {
      variableGroupName: 'second-group',
    });
    await bindVariableGroup(installPayload, 'first-group', {
      projectName: 'billing',
    });
    await bindVariableGroup(installPayload, 'second-group', {
      projectName: 'billing',
    });

    const response: LightMyRequestResponse = await injectVariablesRequest(
      installPayload,
      'POST',
      '/v1/variable-groups/import',
      {
        entries: [{ keyName: 'DATABASE_URL', value: 'postgres://two' }],
        variableGroupName: 'second-group',
      },
    );

    expectJsonError(response, 409, 'variable_collision');
  });

  it('replaces existing variable group keys during import --replace', async (): Promise<void> => {
    const installPayload: InstallResponse = await installAndRegisterNode();

    await createVariableGroup(installPayload, {
      variableGroupName: 'runtime-replace',
    });
    await putVariableGroupVariable(installPayload, {
      keyName: 'LOG_LEVEL',
      value: 'info',
      variableGroupName: 'runtime-replace',
    });

    const importPayload: ImportVariableGroupResponse = await importVariableGroup(installPayload, {
      entries: [
        { keyName: 'FEATURE_FLAG', value: 'enabled' },
        { keyName: 'LOG_LEVEL', value: 'debug' },
      ],
      replace: true,
      variableGroupName: 'runtime-replace',
    });

    expect(importPayload.importedKeyNames).toEqual(['FEATURE_FLAG', 'LOG_LEVEL']);
    expect(await readStoredVariableGroupValues('runtime-replace')).toEqual({
      FEATURE_FLAG: 'enabled',
      LOG_LEVEL: 'debug',
    });
  });

  it('does not create target state when binding a missing variable group', async (): Promise<void> => {
    const installPayload: InstallResponse = await installAndRegisterNode();

    const response: LightMyRequestResponse = await injectVariablesRequest(
      installPayload,
      'POST',
      buildVariablePath('/v1/variables/bindings/missing-group', { projectName: 'fresh-project' }),
    );

    expectJsonError(response, 404, 'variable_group_not_found');
    expect(
      (await db.select().from(projects)).some(
        (project: typeof projects.$inferSelect): boolean => project.name === 'fresh-project',
      ),
    ).toBe(false);
  });
});

async function installAndRegisterNode(): Promise<InstallResponse> {
  const installPayload: InstallResponse = await installCompartment(app);
  await registerLocalNode(app);
  return installPayload;
}

async function deployWebService(installPayload: InstallResponse): Promise<void> {
  const response: LightMyRequestResponse = await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev', {
    descriptor: {
      name: 'billing',
      services: {
        web: '.',
      },
    },
    sourceArchive: await createSourceArchive({
      'compartment.yml': 'name: billing\nservices:\n  web: .\n',
      'package.json': '{"name":"billing-web"}\n',
    }),
  });

  expect(response.statusCode).toBe(200);
}

async function setVariable(installPayload: InstallResponse, payload: SetVariableRequest): Promise<VariableResponse> {
  const response: LightMyRequestResponse = await injectVariablesRequest(
    installPayload,
    'POST',
    '/v1/variables',
    payload,
  );
  expect(response.statusCode).toBe(200);
  return variableResponseSchema.parse(response.json());
}

async function showVariable(
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

async function createVariableGroup(
  installPayload: InstallResponse,
  payload: CreateVariableGroupRequest,
): Promise<VariableGroupResponse> {
  const response: LightMyRequestResponse = await injectVariablesRequest(
    installPayload,
    'POST',
    '/v1/variable-groups',
    payload,
  );
  expect(response.statusCode).toBe(200);
  return variableGroupResponseSchema.parse(response.json());
}

async function listVariableGroups(installPayload: InstallResponse): Promise<VariableGroupListResponse> {
  const response: LightMyRequestResponse = await injectVariablesRequest(installPayload, 'GET', '/v1/variable-groups');
  expect(response.statusCode).toBe(200);
  return variableGroupListResponseSchema.parse(response.json());
}

async function showVariableGroup(
  installPayload: InstallResponse,
  variableGroupName: string,
): Promise<VariableGroupResponse> {
  const response: LightMyRequestResponse = await injectVariablesRequest(
    installPayload,
    'GET',
    `/v1/variable-groups/${encodeURIComponent(variableGroupName)}`,
  );
  expect(response.statusCode).toBe(200);
  return variableGroupResponseSchema.parse(response.json());
}

async function putVariableGroupVariable(
  installPayload: InstallResponse,
  payload: PutVariableGroupVariableRequest,
): Promise<VariableGroupResponse> {
  const response: LightMyRequestResponse = await injectVariablesRequest(
    installPayload,
    'POST',
    '/v1/variable-groups/variables',
    payload,
  );
  expect(response.statusCode).toBe(200);
  return variableGroupResponseSchema.parse(response.json());
}

async function importVariableGroup(
  installPayload: InstallResponse,
  payload: ImportVariableGroupRequest,
): Promise<ImportVariableGroupResponse> {
  const response: LightMyRequestResponse = await injectVariablesRequest(
    installPayload,
    'POST',
    '/v1/variable-groups/import',
    payload,
  );
  expect(response.statusCode).toBe(200);
  return importVariableGroupResponseSchema.parse(response.json());
}

async function captureVariableGroup(
  installPayload: InstallResponse,
  payload: CaptureVariableGroupRequest,
): Promise<CaptureVariableGroupResponse> {
  const response: LightMyRequestResponse = await injectVariablesRequest(
    installPayload,
    'POST',
    '/v1/variable-groups/capture',
    payload,
  );
  expect(response.statusCode).toBe(200);
  return captureVariableGroupResponseSchema.parse(response.json());
}

async function listVariableGroupUsages(
  installPayload: InstallResponse,
  variableGroupName: string,
): Promise<VariableGroupUsagesResponse> {
  const response: LightMyRequestResponse = await injectVariablesRequest(
    installPayload,
    'GET',
    `/v1/variable-groups/${encodeURIComponent(variableGroupName)}/usages`,
  );
  expect(response.statusCode).toBe(200);
  return variableGroupUsagesResponseSchema.parse(response.json());
}

async function bindVariableGroup(
  installPayload: InstallResponse,
  variableGroupName: string,
  query: Record<string, string>,
): Promise<VariableGroupBindingResponse> {
  const response: LightMyRequestResponse = await injectVariablesRequest(
    installPayload,
    'POST',
    buildVariablePath(`/v1/variables/bindings/${encodeURIComponent(variableGroupName)}`, query),
  );
  expect(response.statusCode).toBe(200);
  return variableGroupBindingResponseSchema.parse(response.json());
}

async function unbindVariableGroup(
  installPayload: InstallResponse,
  variableGroupName: string,
  query: Record<string, string>,
): Promise<VariableGroupBindingResponse> {
  const response: LightMyRequestResponse = await injectVariablesRequest(
    installPayload,
    'DELETE',
    buildVariablePath(`/v1/variables/bindings/${encodeURIComponent(variableGroupName)}`, query),
  );
  expect(response.statusCode).toBe(200);
  return variableGroupBindingResponseSchema.parse(response.json());
}

async function injectVariablesRequest(
  installPayload: InstallResponse,
  method: 'DELETE' | 'GET' | 'POST',
  url: string,
  payload?:
    | CaptureVariableGroupRequest
    | CreateVariableGroupRequest
    | ImportVariableGroupRequest
    | PutVariableGroupVariableRequest
    | SetVariableRequest,
): Promise<LightMyRequestResponse> {
  const request: {
    headers: Record<string, string>;
    method: 'DELETE' | 'GET' | 'POST';
    url: string;
  } = {
    headers: {
      authorization: `Bearer ${installPayload.sessionToken}`,
      [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
    },
    method,
    url,
  };

  return await app.inject(payload !== undefined ? { ...request, payload } : request);
}

async function readStoredVariableGroupValues(variableGroupName: string): Promise<Record<string, string>> {
  const variableGroup: typeof organizationVariableSets.$inferSelect | undefined = (
    await db.select().from(organizationVariableSets)
  ).find((row: typeof organizationVariableSets.$inferSelect): boolean => row.name === variableGroupName);
  if (variableGroup === undefined) {
    throw new Error(`Expected variable group ${variableGroupName}.`);
  }

  const entries: (typeof organizationVariableSetEntries.$inferSelect)[] = (
    await db.select().from(organizationVariableSetEntries)
  ).filter(
    (row: typeof organizationVariableSetEntries.$inferSelect): boolean =>
      row.organizationVariableSetId === variableGroup.id,
  );

  return Object.fromEntries(
    entries.map((entry: typeof organizationVariableSetEntries.$inferSelect): [string, string] => [
      entry.keyName,
      decryptVariableValueFromStorage(entry.valueCiphertext, entry.encryptionKeyId, apiConfig.variablesMasterKey),
    ]),
  );
}

function buildVariablePath(basePath: string, query: Record<string, string>): string {
  const searchParams: URLSearchParams = new URLSearchParams(query);
  return `${basePath}?${searchParams.toString()}`;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right);
}
