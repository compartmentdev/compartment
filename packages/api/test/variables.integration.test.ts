import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { eq } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';
import {
  importVariablesResponseSchema,
  compartmentCurrentOrganizationHeaderName,
  removeVariableResponseSchema,
  type ImportVariablesRequest,
  type ImportVariablesResponse,
  type SetVariableRequest,
  type InstallResponse,
  type RemoveVariableResponse,
  type VariableListItem,
  type VariableListResponse,
  type VariableLocalRunRequest,
  type VariableLocalRunResponse,
  type VariableResponse,
  variableLocalRunResponseSchema,
  variableListResponseSchema,
  variableResponseSchema,
} from '@compartment/contracts';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '@compartment/test-support';
import { createApp } from '../src/app';
import type { ApiApp } from '../src/app.types';
import { type ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import {
  environmentVariableSetBindings,
  environmentVariableValues,
  environmentResourceOutputVariableBindings,
  environments,
  organizations,
  organizationVariableSetEntries,
  organizationVariableSets,
  projects,
  projectServices,
  variableAccessEvents,
} from '../src/db/schema';
import type * as VariablesQueryModule from '../src/queries/variables.query';
import {
  buildDeploymentRuntimePlan,
  type DeploymentRuntimePlan,
} from '../src/services/deployment-runtime-plan.service';
import { createOrganizationMemberSession as createOrganizationMemberSessionFixture } from './api-auth-session-test.fixtures';
import { useApiDatabaseTestHarness } from './api-db-test.harness';
import { expectJsonError } from './api-route-test.harness';
import { createSourceArchive, injectDeployRequest, installCompartment } from './api-integration.harness';
import { encryptVariableValueForStorageForTests, type TestEncryptedVariableValue } from './variables-test-crypto';
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
const variablesDatabaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'api_variables_routes');
const apiConfig: ApiConfig = createApiTestConfig({
  databaseUrl: variablesDatabaseUrl,
  publicHttpPort: 80,
  sourceArchiveDirectory: join(tmpdir(), 'compartment-api-variables-source-archives'),
});
const pool: Pool = createDatabasePool(variablesDatabaseUrl);
const db: Database = createDatabase(pool);
const app: ApiApp = createApp({ config: apiConfig, pool });

describe('variables integration', (): void => {
  useApiDatabaseTestHarness(variablesDatabaseUrl);

  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  afterAll(async (): Promise<void> => {
    await app.close();
  });

  it('writes, lists, shows, and removes a plain environment variable', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();
    const setPayload: VariableResponse = await setVariable(installPayload, {
      keyName: 'LOG_LEVEL',
      projectName: 'billing',
      value: 'info',
    });

    expect(setPayload.project.name).toBe('billing');
    expect(setPayload.environment.name).toBe('production');
    expect(setPayload.variable.value).toBe('info');
    expect(setPayload.variable.valueHidden).toBe(false);

    const listPayload: VariableListResponse = await listVariables(installPayload, {
      projectName: 'billing',
    });
    expect(listPayload.variables).toEqual([
      expect.objectContaining({
        keyName: 'LOG_LEVEL',
        scopeType: 'environment',
        sensitivity: 'plain',
        sourceType: 'direct',
      }),
    ]);

    const showPayload: VariableResponse = await showVariable(installPayload, 'LOG_LEVEL', {
      projectName: 'billing',
    });
    expect(showPayload.variable.value).toBe('info');
    expect(showPayload.variable.valueHidden).toBe(false);

    const removePayload: RemoveVariableResponse = await removeVariable(installPayload, 'LOG_LEVEL', {
      projectName: 'billing',
    });
    expect(removePayload.success).toBe(true);

    const listAfterDelete: VariableListResponse = await listVariables(installPayload, {
      projectName: 'billing',
    });
    expect(listAfterDelete.variables).toEqual([]);
  });

  it('uses service-scoped direct variables as effective winners over environment-scoped values', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();
    await deployWebService(installPayload);

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

    const serviceList: VariableListResponse = await listVariables(installPayload, {
      projectName: 'billing',
      serviceName: 'web',
    });
    expect(serviceList.variables).toEqual([
      expect.objectContaining({
        keyName: 'DATABASE_URL',
        scopeType: 'environment',
        sourceType: 'inherited',
      }),
      expect.objectContaining({
        keyName: 'LOG_LEVEL',
        scopeType: 'service',
        sourceType: 'direct',
      }),
    ]);

    const serviceShow: VariableResponse = await showVariable(installPayload, 'LOG_LEVEL', {
      projectName: 'billing',
      serviceName: 'web',
    });
    expect(serviceShow.variable.value).toBe('debug');
    expect(serviceShow.variable.scopeType).toBe('service');
  });

  it('keeps empty service variables from breaking later reads and deployment planning', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();
    await deployWebService(installPayload);

    const setPayload: VariableResponse = await setVariable(installPayload, {
      keyName: 'OPTIONAL_VALUE',
      projectName: 'billing',
      serviceName: 'web',
      value: '',
    });
    expect(setPayload.variable.value).toBe('');

    await setVariable(installPayload, {
      keyName: 'GREETING',
      projectName: 'billing',
      serviceName: 'web',
      value: 'hello',
    });

    const serviceList: VariableListResponse = await listVariables(installPayload, {
      projectName: 'billing',
      serviceName: 'web',
    });
    expect(serviceList.variables).toEqual([
      expect.objectContaining({
        keyName: 'GREETING',
        scopeType: 'service',
        sourceType: 'direct',
      }),
      expect.objectContaining({
        keyName: 'OPTIONAL_VALUE',
        scopeType: 'service',
        sourceType: 'direct',
      }),
    ]);

    const greetingShow: VariableResponse = await showVariable(installPayload, 'GREETING', {
      projectName: 'billing',
      serviceName: 'web',
    });
    expect(greetingShow.variable.value).toBe('hello');

    const target: VariableSetBindingTarget = await readVariableSetBindingTarget('web');
    const serviceId: string = readRequiredFixtureRow(target.serviceId ?? undefined, 'web service id');
    const runtimePlan: DeploymentRuntimePlan = await buildDeploymentRuntimePlan(
      target.environmentId,
      installPayload.organization.id,
      serviceId,
      'production',
      'billing',
      'web',
    );
    expect(runtimePlan.runtimeEnv.GREETING).toBe('hello');
    expect(runtimePlan.runtimeEnv.OPTIONAL_VALUE).toBe('');
  });

  it('returns a specific error when a stored variable cannot be decrypted', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();
    await setVariable(installPayload, {
      keyName: 'BROKEN_VALUE',
      projectName: 'billing',
      value: 'secret',
    });
    await db
      .update(environmentVariableValues)
      .set({ valueCiphertext: JSON.stringify('unsupported envelope') })
      .where(eq(environmentVariableValues.keyName, 'BROKEN_VALUE'));

    const response: LightMyRequestResponse = await injectVariablesRequest(
      installPayload,
      'GET',
      buildVariablePath('/v1/variables/BROKEN_VALUE', { projectName: 'billing' }),
    );

    expectJsonError(response, 400, 'invalid_deploy_config');
    expect(response.json()).toEqual({
      error: {
        code: 'invalid_deploy_config',
        message: 'Variable "BROKEN_VALUE" cannot be decrypted.',
      },
    });
  });

  it('stores service resource-output bindings by service name before first deploy', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();
    await setVariable(installPayload, {
      keyName: 'LOG_LEVEL',
      projectName: 'billing',
      value: 'info',
    });

    const setPayload: VariableResponse = await setVariable(installPayload, {
      fromResource: 'postgres.connection-url',
      keyName: 'DATABASE_URL',
      projectName: 'billing',
      serviceName: 'web',
    });
    const serviceRows: (typeof projectServices.$inferSelect)[] = await db.select().from(projectServices);
    const bindingRows: (typeof environmentResourceOutputVariableBindings.$inferSelect)[] = await db
      .select()
      .from(environmentResourceOutputVariableBindings);

    expect(serviceRows).toEqual([]);
    expect(bindingRows).toEqual([
      expect.objectContaining({
        keyName: 'DATABASE_URL',
        outputName: 'connection-url',
        resourceName: 'postgres',
        targetServiceName: 'web',
      }),
    ]);
    expect(setPayload.variable).toMatchObject({
      keyName: 'DATABASE_URL',
      scopeServiceName: 'web',
      sourceResourceOutput: 'postgres.connection-url',
      sourceType: 'resource_output',
      value: null,
      valueHidden: true,
    });
  });

  it('removes service resource-output bindings by service name before first deploy', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();

    await setVariable(installPayload, {
      fromResource: 'postgres.connection-url',
      keyName: 'DATABASE_URL',
      projectName: 'billing',
      serviceName: 'web',
    });
    const removePayload: RemoveVariableResponse = await removeVariable(installPayload, 'DATABASE_URL', {
      projectName: 'billing',
      serviceName: 'web',
    });
    const serviceRows: (typeof projectServices.$inferSelect)[] = await db.select().from(projectServices);
    const bindingRows: (typeof environmentResourceOutputVariableBindings.$inferSelect)[] = await db
      .select()
      .from(environmentResourceOutputVariableBindings);
    const missingResponse: LightMyRequestResponse = await injectVariablesRequest(
      installPayload,
      'DELETE',
      buildVariablePath('/v1/variables/DATABASE_URL', {
        projectName: 'billing',
        serviceName: 'web',
      }),
    );

    expect(removePayload.success).toBe(true);
    expect(serviceRows).toEqual([]);
    expect(bindingRows).toEqual([]);
    expectJsonError(missingResponse, 404, 'variable_not_found');
  });

  it('rejects a resource-output binding when a literal service variable already exists', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();
    await deployWebService(installPayload);
    await setVariable(installPayload, {
      keyName: 'DATABASE_URL',
      projectName: 'billing',
      serviceName: 'web',
      value: 'postgres://literal',
    });

    const response: LightMyRequestResponse = await injectVariablesRequest(installPayload, 'POST', '/v1/variables', {
      fromResource: 'postgres.connection-url',
      keyName: 'DATABASE_URL',
      projectName: 'billing',
      serviceName: 'web',
    });

    expectJsonError(response, 400, 'invalid_variable_target');
    expect(response.body).toContain('already has a literal value');
    expect(await db.select().from(environmentResourceOutputVariableBindings)).toEqual([]);
  });

  it('rejects a literal service variable when a resource-output binding already exists', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();
    await deployWebService(installPayload);
    await setVariable(installPayload, {
      fromResource: 'postgres.connection-url',
      keyName: 'DATABASE_URL',
      projectName: 'billing',
      serviceName: 'web',
    });

    const response: LightMyRequestResponse = await injectVariablesRequest(installPayload, 'POST', '/v1/variables', {
      keyName: 'DATABASE_URL',
      projectName: 'billing',
      serviceName: 'web',
      value: 'postgres://literal',
    });

    expectJsonError(response, 400, 'invalid_variable_target');
    expect(response.body).toContain('already has a resource output binding');
  });

  it('replaces an existing resource-output binding for the same service key', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();

    await setVariable(installPayload, {
      fromResource: 'postgres.connection-url',
      keyName: 'DATABASE_URL',
      projectName: 'billing',
      serviceName: 'web',
    });
    await setVariable(installPayload, {
      fromResource: 'postgres.replica-url',
      keyName: 'DATABASE_URL',
      projectName: 'billing',
      serviceName: 'web',
    });
    const bindingRows: (typeof environmentResourceOutputVariableBindings.$inferSelect)[] = await db
      .select()
      .from(environmentResourceOutputVariableBindings);

    expect(bindingRows).toEqual([
      expect.objectContaining({
        keyName: 'DATABASE_URL',
        outputName: 'replica-url',
        resourceName: 'postgres',
        targetServiceName: 'web',
      }),
    ]);
  });

  it('keeps resource-scoped variables isolated from environment and service targets', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();
    await deployWebService(installPayload);

    await setVariable(installPayload, {
      keyName: 'LOG_LEVEL',
      projectName: 'billing',
      value: 'info',
    });
    await setVariable(installPayload, {
      keyName: 'LOG_LEVEL',
      projectName: 'billing',
      serviceName: 'web',
      value: 'service-debug',
    });
    const setPayload: VariableResponse = await setVariable(installPayload, {
      keyName: 'LOG_LEVEL',
      projectName: 'billing',
      resourceName: 'postgres',
      value: 'resource-debug',
    });

    expect(setPayload.resourceName).toBe('postgres');
    expect(setPayload.variable.scopeType).toBe('resource');
    expect(setPayload.variable.scopeResourceName).toBe('postgres');
    expect(setPayload.variable.value).toBe('resource-debug');

    const resourceList: VariableListResponse = await listVariables(installPayload, {
      projectName: 'billing',
      resourceName: 'postgres',
    });
    expect(resourceList.variables).toEqual([
      expect.objectContaining({
        keyName: 'LOG_LEVEL',
        scopeResourceName: 'postgres',
        scopeType: 'resource',
        sourceType: 'direct',
      }),
    ]);

    const localRunPayload: VariableLocalRunResponse = await loadVariablesForLocalRun(installPayload, {
      environmentName: 'production',
      productionAck: true,
      projectName: 'billing',
      resourceName: 'postgres',
      serviceName: null,
    });
    expect(localRunPayload.resourceName).toBe('postgres');
    expect(localRunPayload.variables).toEqual([
      expect.objectContaining({
        keyName: 'LOG_LEVEL',
        scopeType: 'resource',
        value: 'resource-debug',
      }),
    ]);
  });

  it('falls back to the environment winner after removing a service-scoped override', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();
    await deployWebService(installPayload);

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

    const removePayload: RemoveVariableResponse = await removeVariable(installPayload, 'LOG_LEVEL', {
      projectName: 'billing',
      serviceName: 'web',
    });
    expect(removePayload.success).toBe(true);

    const showPayload: VariableResponse = await showVariable(installPayload, 'LOG_LEVEL', {
      projectName: 'billing',
      serviceName: 'web',
    });
    expect(showPayload.variable).toEqual(
      expect.objectContaining({
        keyName: 'LOG_LEVEL',
        scopeType: 'environment',
        sourceType: 'inherited',
        value: 'info',
        valueHidden: false,
      }),
    );

    const serviceList: VariableListResponse = await listVariables(installPayload, {
      projectName: 'billing',
      serviceName: 'web',
    });
    expect(
      serviceList.variables.find((variable: VariableListItem): boolean => variable.keyName === 'LOG_LEVEL'),
    ).toEqual(
      expect.objectContaining({
        keyName: 'LOG_LEVEL',
        scopeType: 'environment',
        sourceType: 'inherited',
      }),
    );
  });

  it('lists environment inventory across service-specific variants by default', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();
    await deployWebService(installPayload);

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

    const listPayload: VariableListResponse = await listVariables(installPayload, {
      projectName: 'billing',
    });

    expect(listPayload.variables).toEqual([
      expect.objectContaining({
        keyName: 'LOG_LEVEL',
        scopeServiceName: null,
        scopeType: 'environment',
        sourceType: 'direct',
      }),
      expect.objectContaining({
        keyName: 'LOG_LEVEL',
        scopeServiceName: 'web',
        scopeType: 'service',
        sourceType: 'direct',
      }),
    ]);
  });

  it('keeps staging isolated from production variables', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();

    await setVariable(installPayload, {
      keyName: 'LOG_LEVEL',
      projectName: 'billing',
      value: 'info',
    });
    await setVariable(installPayload, {
      environmentName: 'staging',
      keyName: 'DATABASE_URL',
      projectName: 'billing',
      value: 'postgres://staging',
    });

    const stagingList: VariableListResponse = await listVariables(installPayload, {
      environmentName: 'staging',
      projectName: 'billing',
    });
    expect(stagingList.variables).toEqual([
      expect.objectContaining({
        keyName: 'DATABASE_URL',
        scopeType: 'environment',
        sourceType: 'direct',
      }),
    ]);
    expect(
      stagingList.variables.find((variable: VariableListItem): boolean => variable.keyName === 'LOG_LEVEL'),
    ).toBeUndefined();
  });

  it('updates variables in an existing environment without runtime preconditions', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();

    await setVariable(installPayload, {
      environmentName: 'staging',
      keyName: 'LOG_LEVEL',
      projectName: 'billing',
      value: 'info',
    });
    const setPayload: VariableResponse = await setVariable(installPayload, {
      environmentName: 'staging',
      keyName: 'LOG_LEVEL',
      projectName: 'billing',
      value: 'debug',
    });
    expect(setPayload.environment.name).toBe('staging');
    expect(setPayload.variable.value).toBe('debug');

    const showPayload: VariableResponse = await showVariable(installPayload, 'LOG_LEVEL', {
      environmentName: 'staging',
      projectName: 'billing',
    });
    expect(showPayload.variable.value).toBe('debug');
  });

  it('rejects unknown service read targets instead of falling back to environment variables', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();

    await setVariable(installPayload, {
      keyName: 'LOG_LEVEL',
      projectName: 'billing',
      value: 'info',
    });

    const listResponse: LightMyRequestResponse = await injectVariablesRequest(
      installPayload,
      'GET',
      buildVariablePath('/v1/variables', {
        projectName: 'billing',
        serviceName: 'typo-worker',
      }),
    );
    expectJsonError(listResponse, 404, 'service_not_found');

    const showResponse: LightMyRequestResponse = await injectVariablesRequest(
      installPayload,
      'GET',
      buildVariablePath('/v1/variables/LOG_LEVEL', {
        projectName: 'billing',
        serviceName: 'typo-worker',
      }),
    );
    expectJsonError(showResponse, 404, 'service_not_found');
  });

  it('does not create a project or environment when service-scoped writes target an unknown service', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();

    const setResponse: LightMyRequestResponse = await injectVariablesRequest(installPayload, 'POST', '/v1/variables', {
      keyName: 'LOG_LEVEL',
      projectName: 'fresh-project',
      serviceName: 'typo-worker',
      value: 'info',
    });
    expectJsonError(setResponse, 404, 'service_not_found');

    const importResponse: LightMyRequestResponse = await injectVariablesRequest(
      installPayload,
      'POST',
      '/v1/variables/import',
      {
        entries: [{ keyName: 'DATABASE_URL', value: 'postgres://db' }],
        projectName: 'fresh-project',
        serviceName: 'typo-worker',
      },
    );
    expectJsonError(importResponse, 404, 'service_not_found');

    const listResponse: LightMyRequestResponse = await injectVariablesRequest(
      installPayload,
      'GET',
      buildVariablePath('/v1/variables', { projectName: 'fresh-project' }),
    );
    expectJsonError(listResponse, 404, 'project_not_found');
    expect(await db.select().from(projects)).toEqual([]);
    expect(await db.select().from(environments)).toEqual([]);
  });

  it('does not create a new environment when service-scoped writes target an unknown service in an existing project', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();
    await deployWebService(installPayload);

    const setResponse: LightMyRequestResponse = await injectVariablesRequest(installPayload, 'POST', '/v1/variables', {
      environmentName: 'staging',
      keyName: 'LOG_LEVEL',
      projectName: 'billing',
      serviceName: 'typo-worker',
      value: 'info',
    });
    expectJsonError(setResponse, 404, 'service_not_found');

    const importResponse: LightMyRequestResponse = await injectVariablesRequest(
      installPayload,
      'POST',
      '/v1/variables/import',
      {
        entries: [{ keyName: 'DATABASE_URL', value: 'postgres://db' }],
        environmentName: 'staging',
        projectName: 'billing',
        serviceName: 'typo-worker',
      },
    );
    expectJsonError(importResponse, 404, 'service_not_found');

    expect(await db.select().from(environments)).toHaveLength(1);
    expect(await db.select().from(projectServices)).toEqual([
      expect.objectContaining({
        kind: 'web',
        name: 'web',
        path: '.',
      }),
    ]);
  });

  it('rejects legacy serviceDefinition payloads before they can mutate service topology', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();
    await deployWebService(installPayload);

    const response: LightMyRequestResponse = await injectVariablesRequest(installPayload, 'POST', '/v1/variables', {
      keyName: 'LOG_LEVEL',
      projectName: 'billing',
      serviceDefinition: {
        kind: 'api',
        path: './legacy-web',
      },
      serviceName: 'web',
      value: 'info',
    } as SetVariableRequest);

    expectJsonError(response, 400, 'invalid_variable_body');
    expect(await db.select().from(projectServices)).toEqual([
      expect.objectContaining({
        kind: 'web',
        name: 'web',
        path: '.',
      }),
    ]);
  });

  it('rejects compartment-reserved variable names at the API boundary', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();

    const response: LightMyRequestResponse = await injectVariablesRequest(installPayload, 'POST', '/v1/variables', {
      keyName: 'COMPARTMENT_PROJECT',
      projectName: 'billing',
      value: 'shadowed',
    });

    expectJsonError(response, 400, 'invalid_variable_body');
    expect(response.body).toContain('Variable names starting with COMPARTMENT_ are reserved');
  });

  it('rejects compartment-reserved variable names for imports at the API boundary', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();

    const response: LightMyRequestResponse = await injectVariablesRequest(
      installPayload,
      'POST',
      '/v1/variables/import',
      {
        entries: [{ keyName: 'COMPARTMENT_PROJECT', value: 'shadowed' }],
        projectName: 'billing',
      },
    );

    expectJsonError(response, 400, 'invalid_variable_import_body');
    expect(response.body).toContain('Variable names starting with COMPARTMENT_ are reserved');
  });

  it('rejects invalid variable names at the API boundary', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();

    const response: LightMyRequestResponse = await injectVariablesRequest(installPayload, 'POST', '/v1/variables', {
      keyName: 'LOG-LEVEL',
      projectName: 'billing',
      value: 'shadowed',
    });

    expectJsonError(response, 400, 'invalid_variable_body');
    expect(response.body).toContain(
      'Variable names must start with a letter or underscore and contain only letters, digits, and underscores.',
    );
  });

  it('rejects invalid variable names for imports at the API boundary', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();

    const response: LightMyRequestResponse = await injectVariablesRequest(
      installPayload,
      'POST',
      '/v1/variables/import',
      {
        entries: [{ keyName: 'LOG-LEVEL', value: 'shadowed' }],
        projectName: 'billing',
      },
    );

    expectJsonError(response, 400, 'invalid_variable_import_body');
    expect(response.body).toContain(
      'Variable names must start with a letter or underscore and contain only letters, digits, and underscores.',
    );
  });

  it('rejects duplicate import keys at the API boundary', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();

    const response: LightMyRequestResponse = await injectVariablesRequest(
      installPayload,
      'POST',
      '/v1/variables/import',
      {
        entries: [
          { keyName: 'LOG_LEVEL', value: 'info' },
          { keyName: 'LOG_LEVEL', value: 'debug' },
        ],
        projectName: 'billing',
      },
    );

    expectJsonError(response, 400, 'invalid_variable_import_body');
    expect(response.body).toContain('Duplicate import key LOG_LEVEL.');
  });

  it('hides sensitive values from explicit reads after write', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();

    const setPayload: VariableResponse = await setVariable(installPayload, {
      keyName: 'DATABASE_URL',
      projectName: 'billing',
      sensitivity: 'sensitive',
      value: 'postgres://sensitive',
    });

    expect(setPayload.variable.sensitivity).toBe('sensitive');
    expect(setPayload.variable.value).toBeNull();
    expect(setPayload.variable.valueHidden).toBe(true);

    const showPayload: VariableResponse = await showVariable(installPayload, 'DATABASE_URL', {
      projectName: 'billing',
    });
    expect(showPayload.variable.value).toBeNull();
    expect(showPayload.variable.valueHidden).toBe(true);
  });

  it('returns plaintext values only through local-run and writes a non-plaintext access audit event', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();

    await setVariable(installPayload, {
      keyName: 'DATABASE_URL',
      projectName: 'billing',
      sensitivity: 'sensitive',
      value: 'postgres://sensitive-local',
    });

    const localRunPayload: VariableLocalRunResponse = await loadVariablesForLocalRun(installPayload, {
      commandName: 'node',
      environmentName: 'production',
      productionAck: true,
      projectName: 'billing',
      serviceName: null,
    });
    const auditRows: (typeof variableAccessEvents.$inferSelect)[] = await db.select().from(variableAccessEvents);

    expect(localRunPayload.variables).toEqual([
      expect.objectContaining({
        keyName: 'DATABASE_URL',
        sensitivity: 'sensitive',
        value: 'postgres://sensitive-local',
      }),
    ]);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toEqual(
      expect.objectContaining({
        commandName: 'node',
        operation: 'local_run',
        production: true,
        targetEnvironmentName: 'production',
        targetProjectName: 'billing',
        targetServiceName: null,
      }),
    );
    expect(JSON.stringify(auditRows[0])).not.toContain('postgres://sensitive-local');
    expect(JSON.parse(auditRows[0]!.sensitivityJson)).toEqual({ DATABASE_URL: 'sensitive' });
    expect(Object.keys(JSON.parse(auditRows[0]!.fingerprintsJson) as Record<string, string>)).toEqual(['DATABASE_URL']);
  });

  it('uses service effective variables and snapshots service targets for local-run audit', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();
    await deployWebService(installPayload);

    await setVariable(installPayload, {
      keyName: 'DATABASE_URL',
      projectName: 'billing',
      value: 'postgres://shared',
    });
    await setVariable(installPayload, {
      keyName: 'DATABASE_URL',
      projectName: 'billing',
      serviceName: 'web',
      value: 'postgres://web',
    });

    const localRunPayload: VariableLocalRunResponse = await loadVariablesForLocalRun(installPayload, {
      commandName: 'node',
      environmentName: 'production',
      productionAck: true,
      projectName: 'billing',
      serviceName: 'web',
    });
    const auditRows: (typeof variableAccessEvents.$inferSelect)[] = await db.select().from(variableAccessEvents);

    expect(localRunPayload.serviceName).toBe('web');
    expect(localRunPayload.variables).toEqual([
      expect.objectContaining({
        keyName: 'DATABASE_URL',
        scopeType: 'service',
        value: 'postgres://web',
      }),
    ]);
    expect(auditRows[0]).toEqual(
      expect.objectContaining({
        targetEnvironmentName: 'production',
        targetProjectName: 'billing',
        targetServiceName: 'web',
      }),
    );
  });

  it('resolves variable-set winners through local-run without losing source metadata', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();
    await deployWebService(installPayload);

    await insertVariableSetBinding(installPayload, 'vset_shared_database', 'shared-database', null);
    await insertVariableSetEntry('vset_shared_database', 'DATABASE_URL', 'postgres://shared-set');
    await insertVariableSetBinding(installPayload, 'vset_web_database', 'web-database', 'web');
    await insertVariableSetEntry('vset_web_database', 'DATABASE_URL', 'postgres://web-set');

    const environmentPayload: VariableLocalRunResponse = await loadVariablesForLocalRun(installPayload, {
      commandName: 'node',
      environmentName: 'production',
      productionAck: true,
      projectName: 'billing',
      serviceName: null,
    });
    const servicePayload: VariableLocalRunResponse = await loadVariablesForLocalRun(installPayload, {
      commandName: 'node',
      environmentName: 'production',
      productionAck: true,
      projectName: 'billing',
      serviceName: 'web',
    });
    const auditRows: (typeof variableAccessEvents.$inferSelect)[] = await db.select().from(variableAccessEvents);

    expect(environmentPayload.variables).toEqual([
      expect.objectContaining({
        keyName: 'DATABASE_URL',
        scopeType: 'environment',
        sourceType: 'set',
        sourceVariableSetName: 'shared-database',
        value: 'postgres://shared-set',
      }),
    ]);
    expect(servicePayload.variables).toEqual([
      expect.objectContaining({
        keyName: 'DATABASE_URL',
        scopeServiceName: 'web',
        scopeType: 'service',
        sourceType: 'set',
        sourceVariableSetName: 'web-database',
        value: 'postgres://web-set',
      }),
    ]);
    expect(auditRows).toHaveLength(2);
    expect(JSON.parse(auditRows[0]!.sensitivityJson)).toEqual({ DATABASE_URL: 'sensitive' });
    expect(Object.keys(JSON.parse(auditRows[1]!.fingerprintsJson) as Record<string, string>)).toEqual(['DATABASE_URL']);
    expect(JSON.stringify(auditRows)).not.toContain('postgres://');
  });

  it('ignores cross-organization variable-set bindings during local-run', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();
    await deployWebService(installPayload);

    await insertVariableSetBinding(installPayload, 'vset_owned_database', 'owned-database', null);
    await insertVariableSetEntry('vset_owned_database', 'OWNED_DATABASE_URL', 'postgres://owned-set');
    await insertForeignVariableSetBinding('vset_foreign_database', 'foreign-database', null);
    await insertVariableSetEntry('vset_foreign_database', 'FOREIGN_DATABASE_URL', 'postgres://foreign-set');

    const localRunPayload: VariableLocalRunResponse = await loadVariablesForLocalRun(installPayload, {
      commandName: 'node',
      environmentName: 'production',
      productionAck: true,
      projectName: 'billing',
      serviceName: null,
    });
    const auditRows: (typeof variableAccessEvents.$inferSelect)[] = await db.select().from(variableAccessEvents);

    expect(localRunPayload.variables).toEqual([
      expect.objectContaining({
        keyName: 'OWNED_DATABASE_URL',
        sourceVariableSetName: 'owned-database',
        value: 'postgres://owned-set',
      }),
    ]);
    expect(JSON.stringify(localRunPayload)).not.toContain('FOREIGN_DATABASE_URL');
    expect(JSON.stringify(localRunPayload)).not.toContain('postgres://foreign-set');
    expect(JSON.stringify(auditRows)).not.toContain('FOREIGN_DATABASE_URL');
    expect(JSON.stringify(auditRows)).not.toContain('postgres://foreign-set');
  });

  it('maps same-scope variable-set key collisions to a business error before audit', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();
    await deployWebService(installPayload);

    await insertVariableSetBinding(installPayload, 'vset_first_database', 'first-database', null);
    await insertVariableSetEntry('vset_first_database', 'DATABASE_URL', 'postgres://first-set');
    await insertVariableSetBinding(installPayload, 'vset_second_database', 'second-database', null);
    await insertVariableSetEntry('vset_second_database', 'DATABASE_URL', 'postgres://second-set');

    const response: LightMyRequestResponse = await injectVariablesRequest(
      installPayload,
      'POST',
      '/v1/variables/local-run',
      {
        commandName: 'node',
        environmentName: 'production',
        productionAck: true,
        projectName: 'billing',
        serviceName: null,
      },
    );

    expectJsonError(response, 409, 'variable_collision');
    expect(await db.select().from(variableAccessEvents)).toEqual([]);
  });

  it('rejects production local-run requests without ack before writing an audit event', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();

    const response: LightMyRequestResponse = await injectVariablesRequest(
      installPayload,
      'POST',
      '/v1/variables/local-run',
      {
        commandName: 'node',
        environmentName: 'production',
        productionAck: false,
        projectName: 'billing',
        serviceName: null,
      },
    );

    expectJsonError(response, 400, 'invalid_variable_local_run_body');
    expect(await db.select().from(variableAccessEvents)).toEqual([]);
  });

  it('fails closed without plaintext when local-run access audit insert fails', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();
    const variablesQuery: typeof VariablesQueryModule = await import('../src/queries/variables.query');

    await setVariable(installPayload, {
      keyName: 'DATABASE_URL',
      projectName: 'billing',
      sensitivity: 'sensitive',
      value: 'postgres://audit-failure',
    });
    vi.spyOn(variablesQuery, 'insertVariableAccessEvent').mockRejectedValueOnce(new Error('audit unavailable'));

    const response: LightMyRequestResponse = await injectVariablesRequest(
      installPayload,
      'POST',
      '/v1/variables/local-run',
      {
        commandName: 'node',
        environmentName: 'production',
        productionAck: true,
        projectName: 'billing',
        serviceName: null,
      },
    );

    expectJsonError(response, 500, 'internal_error');
    expect(response.body).not.toContain('postgres://audit-failure');
    expect(await db.select().from(variableAccessEvents)).toEqual([]);
  });

  it('rejects unresolved local-run targets without creating rows or audit events', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();

    const unknownProjectResponse: LightMyRequestResponse = await injectVariablesRequest(
      installPayload,
      'POST',
      '/v1/variables/local-run',
      {
        commandName: 'node',
        environmentName: 'development',
        productionAck: false,
        projectName: 'fresh-project',
        serviceName: null,
      },
    );
    expectJsonError(unknownProjectResponse, 404, 'project_not_found');

    await setVariable(installPayload, {
      keyName: 'LOG_LEVEL',
      projectName: 'billing',
      value: 'info',
    });

    const unknownEnvironmentResponse: LightMyRequestResponse = await injectVariablesRequest(
      installPayload,
      'POST',
      '/v1/variables/local-run',
      {
        commandName: 'node',
        environmentName: 'development',
        productionAck: false,
        projectName: 'billing',
        serviceName: null,
      },
    );
    expectJsonError(unknownEnvironmentResponse, 404, 'environment_not_found');

    const unknownServiceResponse: LightMyRequestResponse = await injectVariablesRequest(
      installPayload,
      'POST',
      '/v1/variables/local-run',
      {
        commandName: 'node',
        environmentName: 'production',
        productionAck: true,
        projectName: 'billing',
        serviceName: 'typo-worker',
      },
    );
    expectJsonError(unknownServiceResponse, 404, 'service_not_found');
    expect(await db.select().from(variableAccessEvents)).toEqual([]);
    expect(await db.select().from(projects)).toHaveLength(1);
    expect(await db.select().from(environments)).toHaveLength(1);
    expect(await db.select().from(projectServices)).toEqual([]);
  });

  it('allows deployers and blocks readonly members from local-run disclosure', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();
    const deployerSessionToken: string = await createOrganizationMemberSession(installPayload, 'deployer');
    const readonlySessionToken: string = await createOrganizationMemberSession(installPayload, 'readonly');

    await setVariable(installPayload, {
      environmentName: 'development',
      keyName: 'LOG_LEVEL',
      projectName: 'billing',
      value: 'debug',
    });

    const deployerResponse: LightMyRequestResponse = await injectVariablesRequestWithSession(
      deployerSessionToken,
      'POST',
      '/v1/variables/local-run',
      {
        commandName: 'node',
        environmentName: 'development',
        productionAck: false,
        projectName: 'billing',
        serviceName: null,
      },
    );
    expect(deployerResponse.statusCode).toBe(200);
    expect(variableLocalRunResponseSchema.parse(deployerResponse.json()).variables).toEqual([
      expect.objectContaining({
        keyName: 'LOG_LEVEL',
        value: 'debug',
      }),
    ]);

    const readonlyResponse: LightMyRequestResponse = await injectVariablesRequestWithSession(
      readonlySessionToken,
      'POST',
      '/v1/variables/local-run',
      {
        commandName: 'node',
        environmentName: 'development',
        productionAck: false,
        projectName: 'billing',
        serviceName: null,
      },
    );
    expectJsonError(readonlyResponse, 403, 'forbidden');
  });

  it('audits empty local-run variable sets with required empty metadata maps', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();

    await setVariable(installPayload, {
      environmentName: 'development',
      keyName: 'LOG_LEVEL',
      projectName: 'billing',
      value: 'debug',
    });
    await removeVariable(installPayload, 'LOG_LEVEL', {
      environmentName: 'development',
      projectName: 'billing',
    });

    const localRunPayload: VariableLocalRunResponse = await loadVariablesForLocalRun(installPayload, {
      commandName: null,
      environmentName: 'development',
      productionAck: false,
      projectName: 'billing',
      serviceName: null,
    });
    const auditRows: (typeof variableAccessEvents.$inferSelect)[] = await db.select().from(variableAccessEvents);

    expect(localRunPayload.variables).toEqual([]);
    expect(JSON.parse(auditRows[0]!.sensitivityJson)).toEqual({});
    expect(JSON.parse(auditRows[0]!.fingerprintsJson)).toEqual({});
  });

  it('imports variables atomically and requires replace for collisions', async (): Promise<void> => {
    const installPayload: InstallResponse = await installTestCompartment();

    await setVariable(installPayload, {
      keyName: 'LOG_LEVEL',
      projectName: 'billing',
      value: 'info',
    });

    const collisionResponse: LightMyRequestResponse = await injectVariablesRequest(
      installPayload,
      'POST',
      '/v1/variables/import',
      {
        entries: [
          { keyName: 'LOG_LEVEL', value: 'debug' },
          { keyName: 'DATABASE_URL', value: 'postgres://db' },
        ],
        projectName: 'billing',
      },
    );

    expectJsonError(collisionResponse, 409, 'variable_collision');

    const listAfterCollision: VariableListResponse = await listVariables(installPayload, {
      projectName: 'billing',
    });
    expect(listAfterCollision.variables).toEqual([
      expect.objectContaining({
        keyName: 'LOG_LEVEL',
        sourceType: 'direct',
      }),
    ]);
    expect(
      listAfterCollision.variables.find((variable: VariableListItem): boolean => variable.keyName === 'DATABASE_URL'),
    ).toBeUndefined();

    const importPayload: ImportVariablesResponse = await importVariables(installPayload, {
      entries: [
        { keyName: 'LOG_LEVEL', value: 'debug' },
        { keyName: 'DATABASE_URL', value: 'postgres://db' },
      ],
      projectName: 'billing',
      replace: true,
    });

    expect(importPayload.importedKeyNames).toEqual(['LOG_LEVEL', 'DATABASE_URL']);

    const showPayload: VariableResponse = await showVariable(installPayload, 'LOG_LEVEL', {
      projectName: 'billing',
    });
    expect(showPayload.variable.value).toBe('debug');

    const listAfterImport: VariableListResponse = await listVariables(installPayload, {
      projectName: 'billing',
    });
    expect(listAfterImport.variables).toEqual([
      expect.objectContaining({
        keyName: 'DATABASE_URL',
        sourceType: 'direct',
      }),
      expect.objectContaining({
        keyName: 'LOG_LEVEL',
        sourceType: 'direct',
      }),
    ]);
  });
});

interface VariableSetBindingTarget {
  environmentId: string;
  serviceId: string | null;
}

async function installTestCompartment(): Promise<InstallResponse> {
  const installPayload: InstallResponse = await installCompartment(app);
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

async function insertVariableSetBinding(
  installPayload: InstallResponse,
  variableSetId: string,
  variableSetName: string,
  serviceName: string | null,
): Promise<void> {
  await insertVariableSetBindingForOrganization(
    installPayload.organization.id,
    variableSetId,
    variableSetName,
    serviceName,
  );
}

async function insertForeignVariableSetBinding(
  variableSetId: string,
  variableSetName: string,
  serviceName: string | null,
): Promise<void> {
  await db.insert(organizations).values({
    id: 'org_foreign_variables',
    name: 'Foreign Variables Org',
    slug: 'foreign-variables',
  });
  await insertVariableSetBindingForOrganization('org_foreign_variables', variableSetId, variableSetName, serviceName);
}

async function insertVariableSetBindingForOrganization(
  organizationId: string,
  variableSetId: string,
  variableSetName: string,
  serviceName: string | null,
): Promise<void> {
  const target: VariableSetBindingTarget = await readVariableSetBindingTarget(serviceName);

  await db.insert(organizationVariableSets).values({
    createdByPrincipalId: null,
    description: 'Local-run variable set fixture',
    id: variableSetId,
    name: variableSetName,
    organizationId,
    updatedAt: new Date('2026-04-07T10:00:00.000Z'),
  });
  await db.insert(environmentVariableSetBindings).values({
    createdByPrincipalId: null,
    environmentId: target.environmentId,
    id: `binding_${variableSetId}`,
    organizationVariableSetId: variableSetId,
    projectServiceId: target.serviceId,
  });
}

async function insertVariableSetEntry(
  organizationVariableSetId: string,
  keyName: string,
  valuePlaintext: string,
): Promise<void> {
  const encryptedValue: TestEncryptedVariableValue = encryptVariableValueForStorageForTests(
    valuePlaintext,
    apiConfig.variablesMasterKey,
  );

  await db.insert(organizationVariableSetEntries).values({
    createdByPrincipalId: null,
    encryptionKeyId: encryptedValue.encryptionKeyId,
    id: `${organizationVariableSetId}_${keyName}`,
    keyName,
    organizationVariableSetId,
    sensitivity: 'sensitive',
    updatedByPrincipalId: null,
    valueCiphertext: encryptedValue.valueCiphertext,
    valueFingerprint: encryptedValue.valueFingerprint,
  });
}

async function readVariableSetBindingTarget(serviceName: string | null): Promise<VariableSetBindingTarget> {
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
  const service: typeof projectServices.$inferSelect | null =
    serviceName === null
      ? null
      : readRequiredFixtureRow(
          (await db.select().from(projectServices)).find(
            (row: typeof projectServices.$inferSelect): boolean =>
              row.projectId === project.id && row.name === serviceName,
          ),
          `${serviceName} service`,
        );

  return {
    environmentId: environment.id,
    serviceId: service?.id ?? null,
  };
}

function readRequiredFixtureRow<T>(row: T | undefined, label: string): T {
  if (row === undefined) {
    throw new Error(`Expected ${label} fixture row.`);
  }
  return row;
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

async function removeVariable(
  installPayload: InstallResponse,
  keyName: string,
  query: Record<string, string>,
): Promise<RemoveVariableResponse> {
  const response: LightMyRequestResponse = await injectVariablesRequest(
    installPayload,
    'DELETE',
    buildVariablePath(`/v1/variables/${encodeURIComponent(keyName)}`, query),
  );
  expect(response.statusCode).toBe(200);
  return removeVariableResponseSchema.parse(response.json());
}

async function importVariables(
  installPayload: InstallResponse,
  payload: ImportVariablesRequest,
): Promise<ImportVariablesResponse> {
  const response: LightMyRequestResponse = await injectVariablesRequest(
    installPayload,
    'POST',
    '/v1/variables/import',
    payload,
  );
  expect(response.statusCode).toBe(200);
  return importVariablesResponseSchema.parse(response.json());
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
