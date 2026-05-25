import { z } from 'zod';
import type {
  CompartmentResourceVolumeMountConfig,
  CompartmentResourceVolumeValue,
} from './compartment-descriptor.types';
import type { ContractSchema } from './schema.types';

const resourceMountPathSchema: ContractSchema<string> = z
  .string()
  .min(1)
  .regex(/^\//u)
  .refine((mountPath: string): boolean => !mountPath.includes(':'));
const compartmentResourceVolumeMountConfigSchema: ContractSchema<CompartmentResourceVolumeMountConfig> = z
  .object({
    mountPath: resourceMountPathSchema,
  })
  .strict();

export const compartmentResourceVolumeValueSchema: ContractSchema<CompartmentResourceVolumeValue> = z.union([
  resourceMountPathSchema,
  compartmentResourceVolumeMountConfigSchema,
]);

export function createResourceVolumeNameSchema(): ContractSchema<string> {
  return z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9_.-]{0,62}$/u);
}
