import { createHash } from 'node:crypto';
import { kubeResourceServiceDns } from '@compartment/utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import type { ApiConfig } from '../src/config';
import type { Database } from '../src/db/client';
import { createVariableValueFingerprint, parseVariablesMasterKey } from '../src/lib/variables-crypto';
import type { ProjectResourceRow } from '../src/queries/resources.query.types';
import { clearApiRuntime, configureApiRuntime } from '../src/runtime/runtime';
import {
  listResolvedResourceOutputSummaries,
  resolveResourceOutputPlaintext,
  type ResolvedResourceOutputPlaintext,
} from '../src/services/resource-output-resolution.service';
import type { EffectiveVariable } from '../src/services/effective-variables.service.types';
import type { ResourceOutputSummaryInput } from '../src/services/resources.service.types';

const variablesMasterKey: Buffer = parseVariablesMasterKey('11'.repeat(32));
const namespaceId: string = 'prj-billing';

describe('resource output resolution service', (): void => {
  afterEach((): void => {
    clearApiRuntime();
  });

  it('renders supported resource output placeholders and hides sensitive plaintext by default', (): void => {
    configureResourceOutputRuntime();
    const resource: ProjectResourceRow = createProjectResourceRow({
      outputsJson: JSON.stringify({
        'connection-url': {
          sensitive: true,
          value:
            'postgres://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@${resource.host}/${env.POSTGRES_DB}?app=${project.name}-${environment.name}',
        },
        'missing-secret': {
          sensitive: true,
          value: 'postgres://${env.MISSING_SECRET}@${resource.host}',
        },
        host: {
          sensitive: false,
          value: '${resource.name}.${environment.name}',
        },
      }),
    });

    const hiddenOutputs: ResourceOutputSummaryInput[] = listResolvedResourceOutputSummaries(
      {
        environmentName: 'production',
        namespaceId,
        projectName: 'billing',
        resource,
      },
      [
        createEffectiveVariable('POSTGRES_DB', 'app'),
        createEffectiveVariable('POSTGRES_PASSWORD', 'secret'),
        createEffectiveVariable('POSTGRES_USER', 'app'),
      ],
      false,
    );

    const hostOutput: ResourceOutputSummaryInput | undefined = hiddenOutputs.find(
      (output: ResourceOutputSummaryInput): boolean => output.name === 'host',
    );
    expect(hostOutput?.valueFingerprint).toBe(
      createVariableValueFingerprint('postgres.production', variablesMasterKey),
    );
    expect(hostOutput?.valueFingerprint).not.toBe(createRawSha256Fingerprint('postgres.production'));

    expect(hiddenOutputs).toMatchObject([
      {
        name: 'connection-url',
        sensitivity: 'sensitive',
        value: null,
        valueFingerprint: null,
        valueHidden: true,
      },
      {
        name: 'host',
        sensitivity: 'plain',
        value: 'postgres.production',
        valueHidden: false,
      },
      {
        name: 'missing-secret',
        sensitivity: 'sensitive',
        value: null,
        valueFingerprint: null,
        valueHidden: true,
      },
    ]);

    const revealed: ResolvedResourceOutputPlaintext = resolveResourceOutputPlaintext(
      resource,
      'connection-url',
      'billing',
      'production',
      namespaceId,
      [
        createEffectiveVariable('POSTGRES_DB', 'app'),
        createEffectiveVariable('POSTGRES_PASSWORD', 'secret'),
        createEffectiveVariable('POSTGRES_USER', 'app'),
      ],
    );

    expect(revealed).toMatchObject({
      sensitivity: 'sensitive',
      value: `postgres://app:secret@${kubeResourceServiceDns(resource.id, namespaceId)}/app?app=billing-production`,
    });
    expect(revealed.valueFingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(revealed.valueFingerprint).toBe(
      createVariableValueFingerprint(
        `postgres://app:secret@${kubeResourceServiceDns(resource.id, namespaceId)}/app?app=billing-production`,
        variablesMasterKey,
      ),
    );
    expect(revealed.valueFingerprint).not.toBe(
      createRawSha256Fingerprint(
        `postgres://app:secret@${kubeResourceServiceDns(resource.id, namespaceId)}/app?app=billing-production`,
      ),
    );
  });

  it('fails clearly when a template references a missing env value', (): void => {
    configureResourceOutputRuntime();

    expect((): void => {
      resolveResourceOutputPlaintext(
        createProjectResourceRow({
          outputsJson: JSON.stringify({
            'connection-url': {
              sensitive: true,
              value: 'postgres://${env.POSTGRES_PASSWORD}@${resource.host}',
            },
          }),
        }),
        'connection-url',
        'billing',
        'production',
        namespaceId,
        [],
      );
    }).toThrow('Resource output template references missing env value "POSTGRES_PASSWORD".');
  });
});

function configureResourceOutputRuntime(): void {
  configureApiRuntime({
    config: createApiConfig(),
    db: {} as Database,
  });
}

function createApiConfig(): ApiConfig {
  return {
    auditFileSink: defaultAuditFileSinkConfig,
    auditRetentionCleanupBatchSize: 1000,
    auditRetentionCleanupCron: '0 3 * * *',
    auditRetentionCleanupMaxBatches: 100,
    usageMeteringIntervalMs: 60_000,
    usageRetentionDays: 400,
    auditRetentionDays: 90,
    builderProfileDigest: 'sha256:' + 'e'.repeat(64),
    baseDomain: 'localhost',
    bindHost: '127.0.0.1',
    tlsMode: 'internal',
    controlPlaneHost: 'console.localhost',
    databaseUrl: 'postgresql://postgres:postgres@127.0.0.1:5432/compartment_test',
    edgeToken: 'edge-token',
    edgeUrl: 'http://127.0.0.1:9081',
    logLevel: 'silent',
    port: 9443,
    publicHttpPort: 80,
    publicHttpsPort: 443,
    publicProtocol: 'http',
    rollbackRetentionLimit: null,
    runtimeControlToken: 'runtime-token',
    sessionSecret: 'test-session-secret',
    sessionTtlMs: 604_800_000,
    sourceArchiveDirectory: '/tmp/source-archives',
    sourceArchiveMaxBytes: 104_857_600,
    systemApiSocketPath: '/tmp/compartment/system-api.sock',
    systemToken: 'system-token',
    throttle: defaultApiAuthThrottleConfig,
    trustedOutboundHosts: [],
    tenantSecretsKek: variablesMasterKey,
    variablesMasterKey,
  };
}

function createProjectResourceRow(overrides: Partial<ProjectResourceRow> = {}): ProjectResourceRow {
  return {
    commandJson: '["postgres"]',
    createdAt: new Date('2026-04-07T10:00:00.000Z'),
    deleteDataRequested: false,
    envJson: JSON.stringify([
      {
        keyName: 'POSTGRES_DB',
        literalValue: 'descriptor-app',
        sourceType: 'literal',
        variableName: null,
      },
    ]),
    environmentId: 'env_production',
    expectedClaimsJson: '[]',
    id: 'res_postgres',
    image: 'postgres:16',
    name: 'postgres',
    operationConfigHash: 'hash',
    operationsJson: '{}',
    outputsJson: '{}',
    portsJson: '[5432]',
    readinessJson: 'null',
    runtimeDefinitionHash: 'hash',
    status: 'running',
    updatedAt: new Date('2026-04-07T10:00:00.000Z'),
    volumesJson: '[]',
    ...overrides,
  };
}

function createEffectiveVariable(keyName: string, value: string): EffectiveVariable {
  return {
    keyName,
    scopeResourceName: 'postgres',
    scopeServiceName: null,
    scopeType: 'resource',
    sensitivity: 'sensitive',
    sourceResourceOutput: null,
    sourceType: 'direct',
    sourceVariableSetName: null,
    value,
  };
}

function createRawSha256Fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
