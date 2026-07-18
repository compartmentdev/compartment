import { z } from 'zod';
import type { CompartmentDeprecatedResourceRestartConfig } from './compartment-descriptor.types';
import type { ContractSchema } from './schema.types';
import { compartmentDeprecatedRestartPolicyValues } from './service-run.contract';

export const compartmentDeprecatedResourceRestartConfigSchema: ContractSchema<CompartmentDeprecatedResourceRestartConfig> =
  z
    .object({
      policy: z.enum(compartmentDeprecatedRestartPolicyValues).optional(),
    })
    .strict();
