import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export type SelfHostedImageSource = 'registry' | 'local';
export type SelfHostedRuntimeImageRegistry = 'github' | 'docker-hub';

export const selfHostedImageSourceSchema: ContractSchema<SelfHostedImageSource> = z.enum(['registry', 'local']);
export const selfHostedRuntimeImageRegistrySchema: ContractSchema<SelfHostedRuntimeImageRegistry> = z.enum([
  'github',
  'docker-hub',
]);
