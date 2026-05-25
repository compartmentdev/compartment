import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import { type ApiConfig } from '../src/config';
import type { Database } from '../src/db/client';
import { clearApiRuntime, configureApiRuntime } from '../src/runtime/runtime';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import type {
  listEnvironmentVariableSetBindings,
  listEnvironmentVariableValues,
  listOrganizationVariableSetNamesByIds,
  listOrganizationVariableSetEntriesForSetIds,
} from '../src/queries/variables.query';
import type { listEnvironmentResourceOutputVariableBindings } from '../src/queries/variables-resource-output.query';
import { buildDeploymentRuntimeEnv } from '../src/services/deployment-runtime-plan.service';
import type {
  EnvironmentResourceOutputVariableBindingRow,
  EnvironmentVariableSetBindingRow,
  EnvironmentVariableValueRow,
  OrganizationVariableSetEntryRow,
} from '../src/queries/variables.query.types';
import type { findProjectResourceByName } from '../src/queries/resources.query';
import type { ProjectResourceRow } from '../src/queries/resources.query.types';
import { encryptVariableValueForStorageForTests, type TestEncryptedVariableValue } from './variables-test-crypto';

type ListEnvironmentVariableValues = typeof listEnvironmentVariableValues;
type ListEnvironmentResourceOutputVariableBindings = typeof listEnvironmentResourceOutputVariableBindings;
type ListEnvironmentVariableSetBindings = typeof listEnvironmentVariableSetBindings;
type ListOrganizationVariableSetNamesByIds = typeof listOrganizationVariableSetNamesByIds;
type ListOrganizationVariableSetEntriesForSetIds = typeof listOrganizationVariableSetEntriesForSetIds;
type FindProjectResourceByName = typeof findProjectResourceByName;

interface DeploymentRuntimePlanServiceMocks {
  findProjectResourceByName: Mock<FindProjectResourceByName>;
  listEnvironmentResourceOutputVariableBindings: Mock<ListEnvironmentResourceOutputVariableBindings>;
  listEnvironmentVariableSetBindings: Mock<ListEnvironmentVariableSetBindings>;
  listEnvironmentVariableValues: Mock<ListEnvironmentVariableValues>;
  listOrganizationVariableSetNamesByIds: Mock<ListOrganizationVariableSetNamesByIds>;
  listOrganizationVariableSetEntriesForSetIds: Mock<ListOrganizationVariableSetEntriesForSetIds>;
}

interface VariablesQueryModuleMock {
  listEnvironmentVariableSetBindings: Mock<ListEnvironmentVariableSetBindings>;
  listEnvironmentVariableValues: Mock<ListEnvironmentVariableValues>;
  listOrganizationVariableSetNamesByIds: Mock<ListOrganizationVariableSetNamesByIds>;
  listOrganizationVariableSetEntriesForSetIds: Mock<ListOrganizationVariableSetEntriesForSetIds>;
}

interface VariablesResourceOutputQueryModuleMock {
  listEnvironmentResourceOutputVariableBindings: Mock<ListEnvironmentResourceOutputVariableBindings>;
}

interface ResourcesQueryModuleMock {
  findProjectResourceByName: Mock<FindProjectResourceByName>;
}

const variablesMasterKey: Buffer = parseVariablesMasterKey('11'.repeat(32));

const apiConfig: ApiConfig = {
  bindHost: '127.0.0.1',
  baseDomain: 'localhost',
  caddyTlsMode: 'internal',
  customTlsDirectory: '/etc/compartment/tls',
  controlPlaneHost: 'console.localhost',
  databaseUrl: 'postgresql://postgres:postgres@127.0.0.1:5432/compartment_test',
  edgeToken: 'edge-token',
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
  sessionSecret: 'session-secret',
  sessionTtlMs: 604_800_000,
  sourceArchiveDirectory: '/tmp/compartment-test-source-archives',
  resourceBackupDirectory: '/tmp/compartment-test-resource-backups',
  sourceArchiveMaxBytes: 104_857_600,
  throttle: defaultApiAuthThrottleConfig,
  runtimeDefaultUpstreamHost: '127.0.0.1',
  nodeAgentSocketPath: '/tmp/compartment/api-test/node/integration.sock',
  systemApiSocketPath: '/tmp/compartment/compartment-runtime-plan-system-api.sock',
  systemToken: 'test-system-token',
  trustedOutboundHosts: [],
  variablesMasterKey,
  runtimeControlToken: 'worker-token',
};

const mocks: DeploymentRuntimePlanServiceMocks = vi.hoisted(
  (): DeploymentRuntimePlanServiceMocks => ({
    findProjectResourceByName: vi.fn<FindProjectResourceByName>(),
    listEnvironmentResourceOutputVariableBindings: vi.fn<ListEnvironmentResourceOutputVariableBindings>(),
    listEnvironmentVariableSetBindings: vi.fn<ListEnvironmentVariableSetBindings>(),
    listEnvironmentVariableValues: vi.fn<ListEnvironmentVariableValues>(),
    listOrganizationVariableSetNamesByIds: vi.fn<ListOrganizationVariableSetNamesByIds>(),
    listOrganizationVariableSetEntriesForSetIds: vi.fn<ListOrganizationVariableSetEntriesForSetIds>(),
  }),
);

vi.mock(
  '../src/queries/variables.query',
  (): VariablesQueryModuleMock => ({
    listEnvironmentVariableSetBindings: mocks.listEnvironmentVariableSetBindings,
    listEnvironmentVariableValues: mocks.listEnvironmentVariableValues,
    listOrganizationVariableSetNamesByIds: mocks.listOrganizationVariableSetNamesByIds,
    listOrganizationVariableSetEntriesForSetIds: mocks.listOrganizationVariableSetEntriesForSetIds,
  }),
);

vi.mock(
  '../src/queries/variables-resource-output.query',
  (): VariablesResourceOutputQueryModuleMock => ({
    listEnvironmentResourceOutputVariableBindings: mocks.listEnvironmentResourceOutputVariableBindings,
  }),
);

vi.mock(
  '../src/queries/resources.query',
  (): ResourcesQueryModuleMock => ({
    findProjectResourceByName: mocks.findProjectResourceByName,
  }),
);

describe('deployment runtime plan service', (): void => {
  beforeEach((): void => {
    configureApiRuntime({
      config: apiConfig,
      db: {} as Database,
    });
    mocks.findProjectResourceByName.mockResolvedValue(undefined);
    mocks.listEnvironmentResourceOutputVariableBindings.mockResolvedValue([]);
    mocks.listEnvironmentVariableSetBindings.mockResolvedValue([]);
    mocks.listEnvironmentVariableValues.mockResolvedValue([]);
    mocks.listOrganizationVariableSetNamesByIds.mockResolvedValue([]);
    mocks.listOrganizationVariableSetEntriesForSetIds.mockResolvedValue([]);
  });

  afterEach((): void => {
    clearApiRuntime();
  });

  it('applies runtime precedence as service direct, service set, environment direct, then environment set', async (): Promise<void> => {
    mocks.listEnvironmentVariableValues.mockResolvedValue([
      createEnvironmentVariableValue('LOG_LEVEL', 'info', null),
      createEnvironmentVariableValue('FEATURE_FLAG', 'disabled', null),
      createEnvironmentVariableValue('LOG_LEVEL', 'debug', 'svc_api'),
      createEnvironmentVariableValue('API_ONLY', 'service-value', 'svc_api'),
    ]);
    mocks.listEnvironmentVariableSetBindings.mockResolvedValue([
      createEnvironmentVariableSetBinding('binding_env_shared', 'set_env_shared', null),
      createEnvironmentVariableSetBinding('binding_service_api', 'set_service_api', 'svc_api'),
    ]);
    mocks.listOrganizationVariableSetEntriesForSetIds.mockResolvedValue([
      createOrganizationVariableSetEntry(
        'set_env_shared:DATABASE_URL',
        'set_env_shared',
        'DATABASE_URL',
        'postgres://env',
      ),
      createOrganizationVariableSetEntry(
        'set_env_shared:FEATURE_FLAG',
        'set_env_shared',
        'FEATURE_FLAG',
        'env-enabled',
      ),
      createOrganizationVariableSetEntry(
        'set_service_api:FEATURE_FLAG',
        'set_service_api',
        'FEATURE_FLAG',
        'service-enabled',
      ),
    ]);

    const runtimeEnv: Record<string, string> = await buildDeploymentRuntimeEnv(
      'env_production',
      'org_123',
      'svc_api',
      'production',
      'billing',
      'api',
    );

    expect(runtimeEnv).toMatchObject({
      API_ONLY: 'service-value',
      DATABASE_URL: 'postgres://env',
      FEATURE_FLAG: 'service-enabled',
      LOG_LEVEL: 'debug',
      COMPARTMENT_ENVIRONMENT: 'production',
      COMPARTMENT_PROJECT: 'billing',
      COMPARTMENT_SERVICE: 'api',
    });
  });

  it('resolves service variables from resource outputs during runtime env creation', async (): Promise<void> => {
    mocks.findProjectResourceByName.mockResolvedValue(
      createProjectResourceRow({
        outputsJson: JSON.stringify({
          'connection-url': {
            sensitive: true,
            value: 'postgres://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@${resource.host}/${env.POSTGRES_DB}',
          },
        }),
      }),
    );
    mocks.listEnvironmentVariableValues.mockResolvedValue([
      createEnvironmentVariableValue('POSTGRES_PASSWORD', 'secret', null, 'env_production', 'postgres'),
    ]);
    mocks.listEnvironmentResourceOutputVariableBindings.mockResolvedValue([
      createEnvironmentResourceOutputVariableBinding('DATABASE_URL', 'api', 'postgres', 'connection-url'),
    ]);

    const runtimeEnv: Record<string, string> = await buildDeploymentRuntimeEnv(
      'env_production',
      'org_123',
      'svc_api',
      'production',
      'billing',
      'api',
    );

    expect(runtimeEnv.DATABASE_URL).toBe('postgres://app:secret@postgres.production.billing.resource.internal/app');
  });

  it('rejects conflicting variable keys coming from multiple sets at the same scope', async (): Promise<void> => {
    mocks.listEnvironmentVariableSetBindings.mockResolvedValue([
      createEnvironmentVariableSetBinding('binding_env_a', 'set_a', null),
      createEnvironmentVariableSetBinding('binding_env_b', 'set_b', null),
    ]);
    mocks.listOrganizationVariableSetEntriesForSetIds.mockResolvedValue([
      createOrganizationVariableSetEntry('set_a:SHARED_KEY', 'set_a', 'SHARED_KEY', 'a'),
      createOrganizationVariableSetEntry('set_b:SHARED_KEY', 'set_b', 'SHARED_KEY', 'b'),
    ]);

    await expect(
      buildDeploymentRuntimeEnv('env_production', 'org_123', 'svc_api', 'production', 'billing', 'api'),
    ).rejects.toThrow('Conflicting environment-scoped variable "SHARED_KEY"');
  });
});

function createEnvironmentVariableValue(
  keyName: string,
  valuePlaintext: string,
  projectServiceId: string | null,
  environmentId: string = 'env_production',
  targetResourceName: string | null = null,
): EnvironmentVariableValueRow {
  const encryptedValue: TestEncryptedVariableValue = encryptVariableValueForStorageForTests(
    valuePlaintext,
    variablesMasterKey,
  );

  return {
    createdAt: new Date('2026-04-07T10:00:00.000Z'),
    createdByPrincipalId: 'prn_123',
    encryptionKeyId: encryptedValue.encryptionKeyId,
    environmentId,
    id: `${environmentId}:${projectServiceId ?? '*'}:${keyName}`,
    keyName,
    projectServiceId,
    targetResourceName,
    sensitivity: 'plain',
    updatedAt: new Date('2026-04-07T10:00:00.000Z'),
    updatedByPrincipalId: 'prn_123',
    valueCiphertext: encryptedValue.valueCiphertext,
    valueFingerprint: encryptedValue.valueFingerprint,
  };
}

function createEnvironmentResourceOutputVariableBinding(
  keyName: string,
  targetServiceName: string,
  resourceName: string,
  outputName: string,
): EnvironmentResourceOutputVariableBindingRow {
  return {
    createdAt: new Date('2026-04-07T10:00:00.000Z'),
    createdByPrincipalId: 'prn_123',
    environmentId: 'env_production',
    id: `vrob_${keyName}`,
    keyName,
    outputName,
    resourceName,
    source: 'cli',
    targetServiceName,
    updatedAt: new Date('2026-04-07T10:00:00.000Z'),
    updatedByPrincipalId: 'prn_123',
  };
}

function createProjectResourceRow(overrides: Partial<ProjectResourceRow> = {}): ProjectResourceRow {
  return {
    commandJson: '["postgres"]',
    containerId: 'container_123',
    createdAt: new Date('2026-04-07T10:00:00.000Z'),
    envJson: JSON.stringify([
      {
        keyName: 'POSTGRES_DB',
        literalValue: 'app',
        sourceType: 'literal',
        variableName: null,
      },
      {
        keyName: 'POSTGRES_USER',
        literalValue: 'app',
        sourceType: 'literal',
        variableName: null,
      },
    ]),
    environmentId: 'env_production',
    hostname: 'postgres.production.billing.resource.internal',
    id: 'res_postgres',
    image: 'postgres:16',
    name: 'postgres',
    operationConfigHash: 'hash',
    operationsJson: '{}',
    outputsJson: '{}',
    portsJson: '[5432]',
    readinessJson: 'null',
    restartPolicy: 'unless-stopped',
    runtimeDefinitionHash: 'hash',
    status: 'running',
    updatedAt: new Date('2026-04-07T10:00:00.000Z'),
    volumesJson: '[]',
    ...overrides,
  };
}

function createEnvironmentVariableSetBinding(
  id: string,
  organizationVariableSetId: string,
  projectServiceId: string | null,
): EnvironmentVariableSetBindingRow {
  return {
    createdAt: new Date('2026-04-07T10:00:00.000Z'),
    createdByPrincipalId: 'prn_123',
    environmentId: 'env_production',
    id,
    organizationVariableSetId,
    projectServiceId,
    targetResourceName: null,
  };
}

function createOrganizationVariableSetEntry(
  id: string,
  organizationVariableSetId: string,
  keyName: string,
  valuePlaintext: string,
): OrganizationVariableSetEntryRow {
  const encryptedValue: TestEncryptedVariableValue = encryptVariableValueForStorageForTests(
    valuePlaintext,
    variablesMasterKey,
  );

  return {
    createdAt: new Date('2026-04-07T10:00:00.000Z'),
    createdByPrincipalId: 'prn_123',
    encryptionKeyId: encryptedValue.encryptionKeyId,
    id,
    keyName,
    organizationVariableSetId,
    sensitivity: 'plain',
    updatedAt: new Date('2026-04-07T10:00:00.000Z'),
    updatedByPrincipalId: 'prn_123',
    valueCiphertext: encryptedValue.valueCiphertext,
    valueFingerprint: encryptedValue.valueFingerprint,
  };
}
