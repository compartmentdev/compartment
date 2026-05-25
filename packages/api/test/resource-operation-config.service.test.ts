import {
  compartmentAuthoredDescriptorSchema,
  type CompartmentAuthoredResourceConfig,
  type VariableScopeType,
} from '@compartment/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildNodeResourceOperationDefinition,
  type ResolvedResourceIntent,
  resolveResourceIntent,
} from '../src/services/resources.service.helpers';
import {
  buildResourceEnvSummary,
  resolveResourceRuntimeEnv,
  type StoredResourceEnvSource,
} from '../src/services/resources.service.storage';
import type { EffectiveVariable } from '../src/services/effective-variables.service.types';

describe('resource operation config resolution', (): void => {
  it('defaults operation image to resource image and overlays operation env', (): void => {
    const intent: ResolvedResourceIntent = resolveResourceIntent(
      'internal-tools',
      'production',
      'postgres',
      {
        env: {
          DATABASE_URL: 'resource-url',
          POSTGRES_DB: 'app',
        },
        image: 'postgres:16',
        operations: {
          backup: {
            command: 'pg_dump "$DATABASE_URL" > "$COMPARTMENT_BACKUP_DIR/dump.sql"',
            env: {
              DATABASE_URL: 'operation-url',
              PGPASSWORD: 'backup-secret',
            },
          },
          restore: {
            command: 'psql "$POSTGRES_DB" < "$COMPARTMENT_BACKUP_DIR/dump.sql"',
            image: 'postgres:17',
          },
        },
      },
      [
        createEffectiveVariable('DATABASE_URL', 'operation-url'),
        createEffectiveVariable('PGPASSWORD', 'resource-secret'),
      ],
    );

    expect(
      buildNodeResourceOperationDefinition(intent, intent.operations.backup!, [
        createEffectiveVariable('DATABASE_URL', 'operation-url'),
        createEffectiveVariable('PGPASSWORD', 'resource-secret'),
      ]),
    ).toEqual({
      command: 'pg_dump "$DATABASE_URL" > "$COMPARTMENT_BACKUP_DIR/dump.sql"',
      env: [
        {
          keyName: 'DATABASE_URL',
          value: 'operation-url',
        },
        {
          keyName: 'POSTGRES_DB',
          value: 'app',
        },
        {
          keyName: 'PGPASSWORD',
          value: 'backup-secret',
        },
      ],
      image: 'postgres:16',
    });
    expect(buildNodeResourceOperationDefinition(intent, intent.operations.restore!, [])).toMatchObject({
      image: 'postgres:17',
    });
  });

  it('resolves postgres preset backup scheduling into resource operation config', (): void => {
    const resource: CompartmentAuthoredResourceConfig | undefined = compartmentAuthoredDescriptorSchema.parse({
      name: 'internal-tools',
      resources: {
        db: {
          preset: 'postgres',
        },
      },
      services: {
        web: '.',
      },
    }).resources?.db;
    if (resource === undefined) {
      throw new Error('Expected db resource.');
    }

    const intent: ResolvedResourceIntent = resolveResourceIntent('internal-tools', 'production', 'db', resource, []);

    expect(intent.operations.backup?.schedule).toEqual({
      interval: 'daily',
      retention: {
        maxAgeDays: 7,
      },
    });
    expect(intent.operations.restore?.command).toContain('psql');
  });

  it('summarizes only literal descriptor resource env sources', (): void => {
    expect(
      buildResourceEnvSummary([
        {
          keyName: 'POSTGRES_DB',
          literalValue: 'app',
          sourceType: 'literal',
          variableName: null,
        },
      ]),
    ).toEqual([
      {
        keyName: 'POSTGRES_DB',
        sourceType: 'literal',
        variableName: null,
      },
    ]);
  });

  it('fails clearly for unsupported legacy variable-sourced stored resource env', (): void => {
    const legacyEnv: StoredResourceEnvSource[] = [
      {
        keyName: 'POSTGRES_PASSWORD',
        literalValue: null,
        sourceType: 'variable',
        variableName: 'POSTGRES_PASSWORD',
      },
    ];

    expect((): void => {
      resolveResourceRuntimeEnv(legacyEnv, [createEffectiveVariable('POSTGRES_PASSWORD', 'secret')]);
    }).toThrow(
      'Resource environment POSTGRES_PASSWORD uses unsupported legacy source type variable. Resource descriptor env is literal-only; move secrets to resource-scoped variables.',
    );
    expect((): void => {
      buildResourceEnvSummary(legacyEnv);
    }).toThrow(
      'Resource environment POSTGRES_PASSWORD uses unsupported legacy source type variable. Resource descriptor env is literal-only; move secrets to resource-scoped variables.',
    );
  });
});

function createEffectiveVariable(
  keyName: string,
  value: string,
  scopeType: VariableScopeType = 'resource',
): EffectiveVariable {
  return {
    keyName,
    scopeResourceName: scopeType === 'resource' ? 'postgres' : null,
    scopeServiceName: null,
    scopeType,
    sensitivity: 'sensitive',
    sourceResourceOutput: null,
    sourceType: 'direct',
    sourceVariableSetName: null,
    value,
  };
}
