import type { SafeParseReturnType } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  compartmentAuthoredDescriptorSchema,
  type CompartmentAuthoredDescriptor,
} from '../src/contracts/compartment-descriptor.contract';

describe('compartment descriptor release config', (): void => {
  it('accepts a service object with release command config', (): void => {
    const descriptor: CompartmentAuthoredDescriptor = compartmentAuthoredDescriptorSchema.parse({
      name: 'backoffice',
      services: {
        api: {
          path: 'apps/api',
          release: {
            command: 'pnpm db:migrate',
          },
        },
      },
    });

    expect(descriptor.services.api).toEqual({
      path: 'apps/api',
      release: {
        command: 'pnpm db:migrate',
      },
    });
  });

  it('rejects empty release commands', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'backoffice',
        services: {
          api: {
            path: 'apps/api',
            release: {
              command: '',
            },
          },
        },
      });

    expect(result.success).toBe(false);
  });
});
