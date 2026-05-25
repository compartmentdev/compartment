import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export type SelfHostedImageSource = 'registry' | 'local';

export const selfHostedImageSourceSchema: ContractSchema<SelfHostedImageSource> = z.enum(['registry', 'local']);
