import { z } from 'zod';
import { environmentSummarySchema, type EnvironmentSummary } from './environments.contract';
import { projectSummarySchema, type ProjectSummary } from './projects.contract';
import { resourceSummarySchema, type ResourceSummary } from './resources.contract';
import type { ContractSchema } from './schema.types';

export interface ResourceOutputSummary {
  name: string;
  sensitivity: 'plain' | 'sensitive';
  value: string | null;
  valueFingerprint: string | null;
  valueHidden: boolean;
}

export interface ResourceOutputListResponse {
  environment: EnvironmentSummary;
  outputs: ResourceOutputSummary[];
  project: ProjectSummary;
  resource: ResourceSummary;
}

export interface ResourceOutputResponse {
  environment: EnvironmentSummary;
  output: ResourceOutputSummary;
  project: ProjectSummary;
  resource: ResourceSummary;
}

const resourceValueFingerprintSchema: ContractSchema<string> = z.string().regex(/^[0-9a-f]{64}$/u);
const resourceOutputSummarySchema: ContractSchema<ResourceOutputSummary> = z
  .object({
    name: z.string().min(1),
    sensitivity: z.enum(['plain', 'sensitive']),
    value: z.string().nullable(),
    valueFingerprint: resourceValueFingerprintSchema.nullable(),
    valueHidden: z.boolean(),
  })
  .strict();

export const resourceOutputListResponseSchema: ContractSchema<ResourceOutputListResponse> = z
  .object({
    environment: environmentSummarySchema,
    outputs: z.array(resourceOutputSummarySchema),
    project: projectSummarySchema,
    resource: resourceSummarySchema,
  })
  .strict();

export const resourceOutputResponseSchema: ContractSchema<ResourceOutputResponse> = z
  .object({
    environment: environmentSummarySchema,
    output: resourceOutputSummarySchema,
    project: projectSummarySchema,
    resource: resourceSummarySchema,
  })
  .strict();
