import { createHash } from 'node:crypto';
import { kubeResourceServiceDns } from '@compartment/utils';
import { afterEach, describe, expect, it } from 'vitest';
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
import { createApiTestConfig } from './api-config-test.fixtures';

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
  return createApiTestConfig({
    publicHttpPort: 80,
    tenantSecretsKek: variablesMasterKey,
    variablesMasterKey,
  });
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
