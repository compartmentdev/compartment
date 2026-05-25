import { nodeRegistrationResponseSchema, type NodeRegistrationResponse } from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApiApp } from '../src/app.types';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import { nodes } from '../src/db/schema';
import {
  cleanupApiIntegrationRuntime,
  configureApiRuntimeWithPublicIngress,
  createApiIntegrationApps,
  createApiIntegrationTestContext,
} from './api-app-test.harness';
import { useApiDatabaseTestHarness } from './api-db-test.harness';
import { injectNodeRegistrationRequest } from './api-integration.harness';

const { apiConfig: defaultApiConfig, databaseUrl: apiIntegrationDatabaseUrl } = createApiIntegrationTestContext(
  'api_integration_node_registration',
  'api-integration-node-registration',
);
let pool!: Pool;
let db!: Database;
let app!: ApiApp;
let systemApp!: ApiApp;
let hasInitializedApiIntegrationRuntime: boolean = false;

describe('node registration integration', (): void => {
  useApiDatabaseTestHarness(apiIntegrationDatabaseUrl);

  beforeEach(async (): Promise<void> => {
    pool = createDatabasePool(apiIntegrationDatabaseUrl);
    db = createDatabase(pool);
    ({ app, systemApp } = await createApiIntegrationApps(defaultApiConfig, db, pool));
    configureApiRuntimeWithPublicIngress(defaultApiConfig, db);
    hasInitializedApiIntegrationRuntime = true;
  });

  afterEach(async (): Promise<void> => {
    if (!hasInitializedApiIntegrationRuntime) {
      return;
    }

    hasInitializedApiIntegrationRuntime = false;
    await cleanupApiIntegrationRuntime(app, systemApp, pool);
  });

  it('persists the registered node socket path', async (): Promise<void> => {
    const registrationResponse: LightMyRequestResponse = await injectNodeRegistrationRequest(app, {
      nodeName: 'local-node',
      nodeSocketPath: defaultApiConfig.nodeAgentSocketPath,
      nodeVersion: '0.1.0',
    });

    expect(registrationResponse.statusCode).toBe(200);
    const registration: NodeRegistrationResponse = nodeRegistrationResponseSchema.parse(registrationResponse.json());
    expect(registration.node.nodeSocketPath).toBe(defaultApiConfig.nodeAgentSocketPath);

    const storedNodes: (typeof nodes.$inferSelect)[] = await db.select().from(nodes);
    expect(storedNodes[0]).toMatchObject({
      nodeSocketPath: defaultApiConfig.nodeAgentSocketPath,
    });
  });
});
