import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';
import {
  importVariablesResponseSchema,
  compartmentCurrentOrganizationHeaderName,
  removeVariableResponseSchema,
  type ImportVariablesRequest,
  type SetVariableRequest,
  type InstallResponse,
  type VariableLocalRunRequest,
  type VariableResponse,
  variableListResponseSchema,
  variableResponseSchema,
} from '@compartment/contracts';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '../../test-support/src';
import { createApp } from '../src/app';
import type { ApiApp } from '../src/app.types';
import { createOrganizationMemberSession as createOrganizationMemberSessionFixture } from './api-auth-session-test.fixtures';
import { useApiDatabaseTestHarness } from './api-db-test.harness';
import { type ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import { expectJsonError } from './api-route-test.harness';
import { installCompartment } from './api-integration.harness';
import { createApiTestConfig } from './api-config-test.fixtures';

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
const variablesDatabaseUrl: string = deriveProcessScopedDatabaseUrl(
  testDatabaseUrl,
  'api_variables_routes_authorization',
);
const apiConfig: ApiConfig = createApiTestConfig({
  databaseUrl: variablesDatabaseUrl,
  publicHttpPort: 80,
  sourceArchiveDirectory: join(tmpdir(), 'compartment-api-variables-authorization-source-archives'),
});
const pool: Pool = createDatabasePool(variablesDatabaseUrl);
const db: Database = createDatabase(pool);
const app: ApiApp = createApp({ config: apiConfig, pool });

describe('variables integration authorization', (): void => {
  useApiDatabaseTestHarness(variablesDatabaseUrl);

  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  afterAll(async (): Promise<void> => {
    await app.close();
  });

  it('allows deployer members to manage variables end to end', async (): Promise<void> => {
    const installPayload: InstallResponse = await installAndRegisterNode();
    const deployerSessionToken: string = await createOrganizationMemberSession(installPayload, 'deployer');

    const setResponse: LightMyRequestResponse = await injectVariablesRequestWithSession(
      deployerSessionToken,
      'POST',
      '/v1/variables',
      {
        keyName: 'LOG_LEVEL',
        projectName: 'billing',
        value: 'info',
      },
    );
    expect(setResponse.statusCode).toBe(200);
    expect(variableResponseSchema.parse(setResponse.json()).variable.value).toBe('info');

    const showResponse: LightMyRequestResponse = await injectVariablesRequestWithSession(
      deployerSessionToken,
      'GET',
      buildVariablePath(`/v1/variables/${encodeURIComponent('LOG_LEVEL')}`, { projectName: 'billing' }),
    );
    expect(showResponse.statusCode).toBe(200);
    expect(variableResponseSchema.parse(showResponse.json()).variable.value).toBe('info');

    const listResponse: LightMyRequestResponse = await injectVariablesRequestWithSession(
      deployerSessionToken,
      'GET',
      buildVariablePath('/v1/variables', { projectName: 'billing' }),
    );
    expect(listResponse.statusCode).toBe(200);
    expect(variableListResponseSchema.parse(listResponse.json()).variables).toEqual([
      expect.objectContaining({
        keyName: 'LOG_LEVEL',
      }),
    ]);

    const importResponse: LightMyRequestResponse = await injectVariablesRequestWithSession(
      deployerSessionToken,
      'POST',
      '/v1/variables/import',
      {
        entries: [{ keyName: 'DATABASE_URL', value: 'postgres://db' }],
        projectName: 'billing',
      },
    );
    expect(importResponse.statusCode).toBe(200);
    expect(importVariablesResponseSchema.parse(importResponse.json()).importedKeyNames).toEqual(['DATABASE_URL']);

    const removeResponse: LightMyRequestResponse = await injectVariablesRequestWithSession(
      deployerSessionToken,
      'DELETE',
      buildVariablePath(`/v1/variables/${encodeURIComponent('LOG_LEVEL')}`, { projectName: 'billing' }),
    );
    expect(removeResponse.statusCode).toBe(200);
    expect(removeVariableResponseSchema.parse(removeResponse.json()).success).toBe(true);
  });

  it('allows readonly members to read variable metadata but blocks secret values and writes', async (): Promise<void> => {
    const installPayload: InstallResponse = await installAndRegisterNode();

    await setVariable(installPayload, {
      keyName: 'LOG_LEVEL',
      projectName: 'billing',
      value: 'info',
    });
    const readonlySessionToken: string = await createOrganizationMemberSession(installPayload, 'readonly');

    const listResponse: LightMyRequestResponse = await injectVariablesRequestWithSession(
      readonlySessionToken,
      'GET',
      buildVariablePath('/v1/variables', { projectName: 'billing' }),
    );
    expect(listResponse.statusCode).toBe(200);

    const showResponse: LightMyRequestResponse = await injectVariablesRequestWithSession(
      readonlySessionToken,
      'GET',
      buildVariablePath(`/v1/variables/${encodeURIComponent('LOG_LEVEL')}`, { projectName: 'billing' }),
    );
    expectJsonError(showResponse, 403, 'forbidden');

    const setResponse: LightMyRequestResponse = await injectVariablesRequestWithSession(
      readonlySessionToken,
      'POST',
      '/v1/variables',
      {
        keyName: 'OTHER_VALUE',
        projectName: 'billing',
        value: 'debug',
      },
    );
    expectJsonError(setResponse, 403, 'forbidden');

    const importResponse: LightMyRequestResponse = await injectVariablesRequestWithSession(
      readonlySessionToken,
      'POST',
      '/v1/variables/import',
      {
        entries: [{ keyName: 'DATABASE_URL', value: 'postgres://db' }],
        projectName: 'billing',
      },
    );
    expectJsonError(importResponse, 403, 'forbidden');

    const removeResponse: LightMyRequestResponse = await injectVariablesRequestWithSession(
      readonlySessionToken,
      'DELETE',
      buildVariablePath(`/v1/variables/${encodeURIComponent('LOG_LEVEL')}`, { projectName: 'billing' }),
    );
    expectJsonError(removeResponse, 403, 'forbidden');
  });

  it('blocks viewer members from variable routes', async (): Promise<void> => {
    const installPayload: InstallResponse = await installAndRegisterNode();
    await setVariable(installPayload, {
      keyName: 'LOG_LEVEL',
      projectName: 'billing',
      value: 'info',
    });
    const viewerSessionToken: string = await createOrganizationMemberSession(installPayload, 'viewer');

    const listResponse: LightMyRequestResponse = await injectVariablesRequestWithSession(
      viewerSessionToken,
      'GET',
      buildVariablePath('/v1/variables', { projectName: 'billing' }),
    );
    expectJsonError(listResponse, 403, 'forbidden');

    const showResponse: LightMyRequestResponse = await injectVariablesRequestWithSession(
      viewerSessionToken,
      'GET',
      buildVariablePath(`/v1/variables/${encodeURIComponent('LOG_LEVEL')}`, { projectName: 'billing' }),
    );
    expectJsonError(showResponse, 403, 'forbidden');
  });
});

async function installAndRegisterNode(): Promise<InstallResponse> {
  const installPayload: InstallResponse = await installCompartment(app);
  return installPayload;
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

async function injectVariablesRequest(
  installPayload: InstallResponse,
  method: 'DELETE' | 'GET' | 'POST',
  url: string,
  payload?: ImportVariablesRequest | SetVariableRequest | VariableLocalRunRequest,
): Promise<LightMyRequestResponse> {
  return await injectVariablesRequestWithSession(installPayload.sessionToken, method, url, payload);
}

async function injectVariablesRequestWithSession(
  sessionToken: string,
  method: 'DELETE' | 'GET' | 'POST',
  url: string,
  payload?: ImportVariablesRequest | SetVariableRequest | VariableLocalRunRequest,
): Promise<LightMyRequestResponse> {
  const request: {
    headers: Record<string, string>;
    method: 'DELETE' | 'GET' | 'POST';
    url: string;
  } = {
    headers: {
      authorization: `Bearer ${sessionToken}`,
      [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
    },
    method,
    url,
  };

  return await app.inject(payload !== undefined ? { ...request, payload } : request);
}

function buildVariablePath(basePath: string, query: Record<string, string>): string {
  const searchParams: URLSearchParams = new URLSearchParams(query);
  return `${basePath}?${searchParams.toString()}`;
}

async function createOrganizationMemberSession(
  installPayload: InstallResponse,
  role: 'deployer' | 'readonly' | 'viewer',
): Promise<string> {
  return await createOrganizationMemberSessionFixture({
    db,
    organizationId: installPayload.organization.id,
    role,
    sessionSecret: apiConfig.sessionSecret,
  });
}
