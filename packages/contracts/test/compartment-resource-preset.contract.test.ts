import { describe, expect, it } from 'vitest';
import type { SafeParseReturnType } from 'zod';

import {
  compartmentAuthoredDescriptorSchema,
  type CompartmentAuthoredDescriptor,
  type CompartmentAuthoredResourceConfig,
} from '../src';

describe('compartment resource preset contracts', (): void => {
  it('pins the postgres preset image by digest', (): void => {
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

    expect(descriptor.resources?.db?.image).toMatch(/^postgres:16-alpine@sha256:[a-f0-9]{64}$/u);
  });

  it('keeps serialized postgres preset password overrides out of generated variables', (): void => {
    const descriptor: CompartmentAuthoredDescriptor = compartmentAuthoredDescriptorSchema.parse({
      name: 'backoffice',
      resources: {
        db: {
          env: {
            POSTGRES_PASSWORD: 'literal-secret',
          },
          preset: 'postgres',
        },
      },
      services: {
        web: '.',
      },
    });

    const reparsedDescriptor: CompartmentAuthoredDescriptor = compartmentAuthoredDescriptorSchema.parse(
      JSON.parse(JSON.stringify(descriptor)),
    );

    expect(reparsedDescriptor.resources?.db?.env?.POSTGRES_PASSWORD).toBe('literal-secret');
    expect(reparsedDescriptor.resources?.db?.generatedVariables).toBeUndefined();
  });

  it('rejects serialized postgres preset resources with changed structural defaults', (): void => {
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
    const serializedDescriptor: CompartmentAuthoredDescriptor = JSON.parse(
      JSON.stringify(descriptor),
    ) as CompartmentAuthoredDescriptor;
    const serializedResource: CompartmentAuthoredResourceConfig | undefined = serializedDescriptor.resources?.db;

    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        ...serializedDescriptor,
        resources: {
          db: {
            ...serializedResource,
            ports: [5433],
          },
        },
      });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message:
              'Preset resources support only env overrides; remove ports or declare a full resource without preset.',
            path: ['resources', 'db', 'ports'],
          }),
        ]),
      );
    }
  });
});
