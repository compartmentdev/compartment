import { describe, expect, it } from 'vitest';
import type { SafeParseReturnType } from 'zod';
import {
  compartmentAuthoredDescriptorSchema,
  type CompartmentAuthoredDescriptor,
  type CompartmentAuthoredServiceConfig,
} from '../src';

describe('compartment descriptor service connections', (): void => {
  it('accepts service connections to normalized resource outputs', (): void => {
    const descriptor: CompartmentAuthoredDescriptor = compartmentAuthoredDescriptorSchema.parse({
      name: 'backoffice',
      resources: {
        db: {
          preset: 'postgres',
        },
      },
      services: {
        api: {
          connections: {
            db: {
              env: {
                DATABASE_URL: 'connection-url',
              },
            },
          },
          path: 'apps/api',
        },
      },
    });
    const service: CompartmentAuthoredServiceConfig = descriptor.services.api as CompartmentAuthoredServiceConfig;

    expect(service.connections).toEqual({
      db: {
        env: {
          DATABASE_URL: 'connection-url',
        },
      },
    });
  });

  it('rejects service connections to missing resources', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'backoffice',
        services: {
          api: {
            connections: {
              db: {
                env: {
                  DATABASE_URL: 'connection-url',
                },
              },
            },
            path: 'apps/api',
          },
        },
      });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'Service "api" connection references unknown resource "db".',
            path: ['services', 'api', 'connections', 'db'],
          }),
        ]),
      );
    }
  });

  it('rejects service connections to missing resource outputs', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'backoffice',
        resources: {
          db: {
            preset: 'postgres',
          },
        },
        services: {
          api: {
            connections: {
              db: {
                env: {
                  DATABASE_URL: 'replica-url',
                },
              },
            },
            path: 'apps/api',
          },
        },
      });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'Service "api" connection env "DATABASE_URL" references unknown resource output "db.replica-url".',
            path: ['services', 'api', 'connections', 'db', 'env', 'DATABASE_URL'],
          }),
        ]),
      );
    }
  });

  it('rejects invalid service connection env keys', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'backoffice',
        resources: {
          db: {
            preset: 'postgres',
          },
        },
        services: {
          api: {
            connections: {
              db: {
                env: {
                  'DATABASE URL': 'connection-url',
                },
              },
            },
            path: 'apps/api',
          },
        },
      });

    expect(result.success).toBe(false);
  });

  it('rejects duplicate service connection env keys across resources', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'backoffice',
        resources: {
          primary: {
            preset: 'postgres',
          },
          replica: {
            preset: 'postgres',
          },
        },
        services: {
          api: {
            connections: {
              primary: {
                env: {
                  DATABASE_URL: 'connection-url',
                },
              },
              replica: {
                env: {
                  DATABASE_URL: 'connection-url',
                },
              },
            },
            path: 'apps/api',
          },
        },
      });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'Service "api" connection env "DATABASE_URL" is declared by both "primary" and "replica".',
            path: ['services', 'api', 'connections', 'replica', 'env', 'DATABASE_URL'],
          }),
        ]),
      );
    }
  });
});
