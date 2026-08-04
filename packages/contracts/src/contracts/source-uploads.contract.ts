import { z } from 'zod';
import { compartmentProjectNameSchema, compartmentServiceNameSchema } from './compartment-descriptor.contract';
import { environmentNameSchema } from './environments.contract';
import type { ContractSchema } from './schema.types';

export const compartmentSourceUploadsPathname: string = '/v1/source-uploads';
export const sourceUploadArchiveMultipartFieldName: string = 'sourceArchive';
export const sourceUploadDigestMultipartFieldName: string = 'sourceDigest';

export interface SourceUploadSummary {
  byteSize: number;
  createdAt: string;
  expiresAt: string;
  id: string;
  sourceDigest: string;
}

export interface SourceUploadCreateQuery {
  environmentName?: string | undefined;
  projectName?: string | undefined;
  serviceName?: string | undefined;
}

export const sourceUploadIdSchema: ContractSchema<string> = z.string().min(1);
export const logicalSourceDigestSchema: ContractSchema<string> = z.string().regex(/^v1:sha256:[a-f0-9]{64}$/u);

export const sourceUploadCreateQuerySchema: ContractSchema<SourceUploadCreateQuery> = z
  .object({
    environmentName: environmentNameSchema.optional(),
    projectName: compartmentProjectNameSchema.optional(),
    serviceName: compartmentServiceNameSchema.optional(),
  })
  .strict()
  .refine(
    (query: SourceUploadCreateQuery): boolean =>
      query.projectName !== undefined || (query.environmentName === undefined && query.serviceName === undefined),
    'projectName is required when environmentName or serviceName is provided.',
  );

export const sourceUploadSummarySchema: ContractSchema<SourceUploadSummary> = z
  .object({
    byteSize: z.number().int().positive(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    id: sourceUploadIdSchema,
    sourceDigest: logicalSourceDigestSchema,
  })
  .strict();
