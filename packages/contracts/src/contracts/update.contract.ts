import { z } from 'zod';
import {
  selfHostedImageSourceSchema,
  selfHostedRuntimeImageRegistrySchema,
  type SelfHostedImageSource,
  type SelfHostedRuntimeImageRegistry,
} from './self-hosted.contract';
import type { ContractSchema } from './schema.types';

const updateStatusValues: readonly ['updated', 'skipped'] = ['updated', 'skipped'];
const updateSkipReasonValues: readonly ['already-current', 'downgrade-not-supported'] = [
  'already-current',
  'downgrade-not-supported',
];

export type UpdateStatus = 'updated' | 'skipped';
export type UpdateSkipReason = 'already-current' | 'downgrade-not-supported';

export interface UpdateResponse {
  backupDir: string | null;
  configDir: string;
  currentVersion: string;
  dataDir: string;
  imageRegistry: SelfHostedRuntimeImageRegistry;
  imageSource: SelfHostedImageSource;
  skipReason: UpdateSkipReason | null;
  status: UpdateStatus;
  targetVersion: string;
}

const updateStatusSchema: ContractSchema<UpdateStatus> = z.enum(updateStatusValues);
const updateSkipReasonSchema: ContractSchema<UpdateSkipReason> = z.enum(updateSkipReasonValues);

export const updateResponseSchema: ContractSchema<UpdateResponse> = z
  .object({
    backupDir: z.string().min(1).nullable(),
    configDir: z.string().min(1),
    currentVersion: z.string().min(1),
    dataDir: z.string().min(1),
    imageRegistry: selfHostedRuntimeImageRegistrySchema,
    imageSource: selfHostedImageSourceSchema,
    skipReason: updateSkipReasonSchema.nullable(),
    status: updateStatusSchema,
    targetVersion: z.string().min(1),
  })
  .strict();
