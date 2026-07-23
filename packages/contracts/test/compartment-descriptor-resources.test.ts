import type { SafeParseReturnType } from 'zod';
import { describe, expect, it } from 'vitest';
import { resourceReadinessTimeoutMaxMs } from '../src/contracts/compartment-resource.contract';
import {
  compartmentAuthoredDescriptorSchema,
  type CompartmentAuthoredDescriptor,
  type CompartmentAuthoredResourceConfig,
} from '../src';

type ResourcePresetRejectedOverride = Partial<
  Pick<
    CompartmentAuthoredResourceConfig,
    'command' | 'generatedVariables' | 'image' | 'operations' | 'outputs' | 'ports' | 'readiness' | 'volumes'
  >
>;

const resourcePresetRejectedOverrides: readonly [string, ResourcePresetRejectedOverride][] = [
  ['command', { command: ['postgres', '-c', 'shared_buffers=256MB'] }],
  ['generatedVariables', { generatedVariables: { API_SECRET: { generator: 'token' } } }],
  ['image', { image: 'postgres:15' }],
  ['operations', { operations: { backup: { command: 'pg_dump "$POSTGRES_DB"' } } }],
  ['outputs', { outputs: { host: { sensitive: false, value: 'custom-host' } } }],
  ['ports', { ports: [5433] }],
  ['readiness', { readiness: { port: 5433, type: 'tcp' } }],
  ['volumes', { volumes: { data: '/data' } }],
];

describe('compartment descriptor resource contracts', (): void => {
  it('owns the resource readiness limit at the authored descriptor boundary', (): void => {
    expect(
      compartmentAuthoredDescriptorSchema.safeParse(readinessDescriptor(resourceReadinessTimeoutMaxMs)).success,
    ).toBe(true);
    expect(
      compartmentAuthoredDescriptorSchema.safeParse(readinessDescriptor(resourceReadinessTimeoutMaxMs + 1)).success,
    ).toBe(false);
  });

  it('accepts Kubernetes-managed resources declared at the top level', (): void => {
    const descriptor: CompartmentAuthoredDescriptor = compartmentAuthoredDescriptorSchema.parse({
      name: 'backoffice',
      resources: {
        postgres: {
          env: {
            POSTGRES_DB: 'app',
          },
          generatedVariables: {
            POSTGRES_PASSWORD: {
              bytes: 32,
              encoding: 'hex',
              generator: 'token',
            },
          },
          image: 'postgres:16',
          ports: [5432],
          readiness: {
            port: 5432,
            timeoutMs: 30_000,
            type: 'tcp',
          },
          volumes: {
            'postgres-data': '/var/lib/postgresql/data',
          },
        },
      },
      services: {
        web: '.',
      },
    });

    expect(descriptor.resources?.postgres?.image).toBe('postgres:16');
    expect(descriptor.resources?.postgres?.generatedVariables?.POSTGRES_PASSWORD).toEqual({
      bytes: 32,
      encoding: 'hex',
      generator: 'token',
    });
  });

  it('rejects removed resource restart settings', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'backoffice',
        resources: {
          postgres: {
            image: 'postgres:16',
            restart: { policy: 'no' },
          },
        },
        services: { web: '.' },
      });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'unrecognized_keys',
            path: ['resources', 'postgres'],
          }),
        ]),
      );
    }
  });

  it('reserves the managed backup claim handle from authored resource volumes', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'backoffice',
        resources: {
          postgres: {
            image: 'postgres:16',
            volumes: { 'backup-artifacts': '/var/lib/postgresql/data' },
          },
        },
        services: { web: '.' },
      });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'backup-artifacts is reserved for managed backups.',
            path: ['resources', 'postgres', 'volumes', 'backup-artifacts'],
          }),
        ]),
      );
    }
  });

  it('expands postgres resource presets before returning descriptor resources', (): void => {
    const descriptor: CompartmentAuthoredDescriptor = compartmentAuthoredDescriptorSchema.parse({
      name: 'backoffice',
      resources: {
        db: {
          preset: 'postgres',
        },
      },
      services: {
        web: '.',
      },
    });

    expect(descriptor.resources?.db).toHaveProperty('preset', 'postgres');
    expect(JSON.parse(JSON.stringify(descriptor.resources?.db))).toHaveProperty('preset', 'postgres');
    expect(
      compartmentAuthoredDescriptorSchema.parse(JSON.parse(JSON.stringify(descriptor))).resources?.db?.preset,
    ).toBe('postgres');
    expect(descriptor.resources?.db).toEqual({
      env: {
        POSTGRES_DB: 'app',
        POSTGRES_USER: 'app',
      },
      generatedVariables: {
        POSTGRES_PASSWORD: {
          generator: 'token',
        },
      },
      image: 'postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777',
      operations: {
        backup: {
          command:
            'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --host "$COMPARTMENT_RESOURCE_HOST" --username "$POSTGRES_USER" "$POSTGRES_DB" > "$COMPARTMENT_BACKUP_DIR/postgres.sql"',
          schedule: {
            interval: 'daily',
            retention: {
              maxAgeDays: 7,
            },
          },
        },
        restore: {
          command:
            'PGPASSWORD="$POSTGRES_PASSWORD" psql --host "$COMPARTMENT_RESOURCE_HOST" --username "$POSTGRES_USER" "$POSTGRES_DB" < "$COMPARTMENT_BACKUP_DIR/postgres.sql"',
        },
      },
      outputs: {
        database: {
          sensitive: false,
          value: '${env.POSTGRES_DB}',
        },
        host: {
          sensitive: false,
          value: '${resource.host}',
        },
        port: {
          sensitive: false,
          value: '5432',
        },
        'connection-url': {
          sensitive: true,
          value: 'postgres://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@${resource.host}:5432/${env.POSTGRES_DB}',
        },
      },
      ports: [5432],
      preset: 'postgres',
      readiness: {
        port: 5432,
        timeoutMs: 60_000,
        type: 'tcp',
      },
      volumes: {
        data: '/var/lib/postgresql/data',
      },
    });
  });

  it('merges postgres preset env overrides without changing structural defaults', (): void => {
    const descriptor: CompartmentAuthoredDescriptor = compartmentAuthoredDescriptorSchema.parse({
      name: 'backoffice',
      resources: {
        db: {
          env: {
            POSTGRES_DB: 'billing',
            POSTGRES_USER: 'billing',
          },
          preset: 'postgres',
        },
      },
      services: {
        web: '.',
      },
    });

    expect(descriptor.resources?.db?.env).toEqual({
      POSTGRES_DB: 'billing',
      POSTGRES_USER: 'billing',
    });
    expect(descriptor.resources?.db?.image).toBe(
      'postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777',
    );
    expect(descriptor.resources?.db?.ports).toEqual([5432]);
    expect(descriptor.resources?.db?.readiness).toEqual({
      port: 5432,
      timeoutMs: 60_000,
      type: 'tcp',
    });
    expect(descriptor.resources?.db?.outputs?.['connection-url']).toEqual({
      sensitive: true,
      value: 'postgres://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@${resource.host}:5432/${env.POSTGRES_DB}',
    });
    expect(descriptor.resources?.db?.volumes).toEqual({
      data: '/var/lib/postgresql/data',
    });
    expect(descriptor.resources?.db?.operations?.backup?.schedule).toEqual({
      interval: 'daily',
      retention: {
        maxAgeDays: 7,
      },
    });
  });

  it.each(resourcePresetRejectedOverrides)(
    'rejects postgres preset %s overrides',
    (fieldName: string, override: ResourcePresetRejectedOverride): void => {
      const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
        compartmentAuthoredDescriptorSchema.safeParse({
          name: 'backoffice',
          resources: {
            db: {
              ...override,
              preset: 'postgres',
            },
          },
          services: {
            web: '.',
          },
        });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              message: `Preset resources support only env overrides; remove ${fieldName} or declare a full resource without preset.`,
              path: ['resources', 'db', fieldName],
            }),
          ]),
        );
      }
    },
  );

  it('accepts resource outputs with declared sensitivity', (): void => {
    const descriptor: CompartmentAuthoredDescriptor = compartmentAuthoredDescriptorSchema.parse({
      name: 'backoffice',
      resources: {
        postgres: {
          env: {
            POSTGRES_DB: 'app',
          },
          image: 'postgres:16',
          outputs: {
            'connection-url': {
              sensitive: true,
              value: 'postgres://${resource.host}/${env.POSTGRES_DB}',
            },
          },
        },
      },
      services: {
        web: '.',
      },
    });

    expect(descriptor.resources?.postgres?.outputs?.['connection-url']).toEqual({
      sensitive: true,
      value: 'postgres://${resource.host}/${env.POSTGRES_DB}',
    });
  });

  it('rejects resource outputs without sensitivity', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'backoffice',
        resources: {
          postgres: {
            image: 'postgres:16',
            outputs: {
              'connection-url': {
                value: 'postgres://${resource.host}',
              },
            },
          },
        },
        services: {
          web: '.',
        },
      });

    expect(result.success).toBe(false);
  });

  it('accepts resource backup and restore operation commands', (): void => {
    const descriptor: CompartmentAuthoredDescriptor = compartmentAuthoredDescriptorSchema.parse({
      name: 'backoffice',
      resources: {
        postgres: {
          env: {
            POSTGRES_DB: 'app',
            POSTGRES_USER: 'app',
          },
          image: 'postgres:16',
          operations: {
            backup: {
              command: 'pg_dump "$POSTGRES_DB" > "$COMPARTMENT_BACKUP_DIR/dump.sql"',
              schedule: {
                interval: 'daily',
                retention: {
                  keepLast: 7,
                  maxAgeDays: 30,
                },
              },
            },
            restore: {
              command: 'psql "$POSTGRES_DB" < "$COMPARTMENT_BACKUP_DIR/dump.sql"',
              env: {
                DATABASE_URL: 'postgres://postgres:postgres@postgres:5432/app',
              },
              image: 'postgres:16',
            },
          },
        },
      },
      services: {
        web: '.',
      },
    });

    expect(descriptor.resources?.postgres?.operations?.backup?.command).toContain('pg_dump');
    expect(descriptor.resources?.postgres?.operations?.backup?.schedule?.retention?.keepLast).toBe(7);
    expect(descriptor.resources?.postgres?.operations?.restore?.image).toBe('postgres:16');
  });

  it('accepts standard cron scheduled resource backup operations', (): void => {
    const expressions: string[] = ['*/15 * * * *', '0 2 * * 1', '0 2 1 * *'];

    for (const cron of expressions) {
      const descriptor: CompartmentAuthoredDescriptor = compartmentAuthoredDescriptorSchema.parse({
        name: 'backoffice',
        resources: {
          postgres: {
            image: 'postgres:16',
            operations: {
              backup: {
                command: 'pg_dump "$POSTGRES_DB" > "$COMPARTMENT_BACKUP_DIR/dump.sql"',
                schedule: {
                  cron,
                  retention: {
                    includeManual: true,
                    keepLast: 14,
                  },
                },
              },
            },
          },
        },
        services: {
          web: '.',
        },
      });

      expect(descriptor.resources?.postgres?.operations?.backup?.schedule?.cron).toBe(cron);
    }
  });

  it('rejects invalid resource backup cron expressions', (): void => {
    const expressions: string[] = ['0 0 0 * * *', '@daily', '60 * * * *'];

    for (const cron of expressions) {
      const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
        compartmentAuthoredDescriptorSchema.safeParse({
          name: 'backoffice',
          resources: {
            postgres: {
              image: 'postgres:16',
              operations: {
                backup: {
                  command: 'pg_dump "$POSTGRES_DB" > "$COMPARTMENT_BACKUP_DIR/dump.sql"',
                  schedule: {
                    cron,
                  },
                },
              },
            },
          },
          services: {
            web: '.',
          },
        });

      expect(result.success).toBe(false);
    }
  });

  it('accepts retention with scheduled resource backup operations', (): void => {
    const descriptor: CompartmentAuthoredDescriptor = compartmentAuthoredDescriptorSchema.parse({
      name: 'backoffice',
      resources: {
        postgres: {
          image: 'postgres:16',
          operations: {
            backup: {
              command: 'pg_dump "$POSTGRES_DB" > "$COMPARTMENT_BACKUP_DIR/dump.sql"',
              schedule: {
                cron: '0 2 * * *',
                retention: {
                  includeManual: true,
                  keepLast: 14,
                },
              },
            },
          },
        },
      },
      services: {
        web: '.',
      },
    });

    expect(descriptor.resources?.postgres?.operations?.backup?.schedule?.cron).toBe('0 2 * * *');
  });

  it('rejects scheduled restore operations', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'backoffice',
        resources: {
          postgres: {
            image: 'postgres:16',
            operations: {
              restore: {
                command: 'psql "$POSTGRES_DB" < "$COMPARTMENT_BACKUP_DIR/dump.sql"',
                schedule: {
                  interval: 'daily',
                },
              },
            },
          },
        },
        services: {
          web: '.',
        },
      });

    expect(result.success).toBe(false);
  });

  it('rejects empty resource operation commands', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'backoffice',
        resources: {
          postgres: {
            image: 'postgres:16',
            operations: {
              backup: {
                command: '',
              },
            },
          },
        },
        services: {
          web: '.',
        },
      });

    expect(result.success).toBe(false);
  });

  it('rejects invalid resource declarations', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'backoffice',
        resources: {
          web: {
            env: {
              COMPARTMENT_SECRET: 'nope',
            },
            image: 'redis:7',
            ports: [70000],
            readiness: {
              port: 6379,
              type: 'tcp',
            },
            volumes: {
              data: 'relative/path',
            },
          },
        },
        services: {
          web: '.',
        },
      });

    expect(result.success).toBe(false);
  });

  it('rejects duplicate resource ports before Kubernetes projection', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'backoffice',
        resources: {
          postgres: {
            image: 'postgres:16',
            ports: [5432, 5432],
          },
        },
        services: {
          web: '.',
        },
      });

    expect(result.success).toBe(false);
  });

  it('rejects resource volume handles that would require lossy Docker name sanitization', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'backoffice',
        resources: {
          cache: {
            image: 'valkey/valkey:8',
            volumes: {
              'data one': '/data',
            },
          },
        },
        services: {
          web: '.',
        },
      });

    expect(result.success).toBe(false);
  });
});

function readinessDescriptor(timeoutMs: number): object {
  return {
    name: 'backoffice',
    resources: {
      postgres: { image: 'postgres:16', ports: [5432], readiness: { port: 5432, timeoutMs, type: 'tcp' } },
    },
    services: { web: '.' },
  };
}
