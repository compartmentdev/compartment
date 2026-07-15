import { z } from 'zod';
import { compartmentProjectNameSchema, compartmentResourceNameSchema } from './compartment-descriptor.contract';
import { compartmentResourceOutputNameSchema } from './compartment-resource.contract';
import { environmentNameSchema, environmentSummarySchema, type EnvironmentSummary } from './environments.contract';
import { logTailLineLimit } from './logs.contract';
import { projectSummarySchema, type ProjectSummary } from './projects.contract';
import type { ContractSchema } from './schema.types';

export type ResourceRuntimeStatus = 'running' | 'stopped';
export type ResourceEnvSourceType = 'literal';
export type ResourceDeleteConfirmation = 'delete-resource-data';

export interface ResourceEnvSourceSummary {
  keyName: string;
  sourceType: ResourceEnvSourceType;
  variableName: null;
}

export interface ResourceVolumeSummary {
  mountPath: string;
  name: string;
}

export interface ResourceReadinessSummary {
  port: number;
  timeoutMs: number;
  type: 'tcp';
}

export interface ResourceSummary {
  createdAt: string;
  env: ResourceEnvSourceSummary[];
  id: string;
  image: string;
  name: string;
  ports: number[];
  readiness: ResourceReadinessSummary | null;
  status: ResourceRuntimeStatus;
  updatedAt: string;
  volumes: ResourceVolumeSummary[];
}

export interface ResourceListQuery {
  environmentName?: string | undefined;
  projectName: string;
}

export interface ResourceTargetQuery extends ResourceListQuery {
  resourceName: string;
}

export interface ResourceOutputQuery extends ResourceTargetQuery {
  outputName: string;
  reveal?: boolean | undefined;
}

export interface ResourceLogsQuery extends ResourceTargetQuery {
  since?: string | undefined;
  tailLines?: number | undefined;
}

export interface ResourceListResponse {
  environment: EnvironmentSummary;
  project: ProjectSummary;
  resources: ResourceSummary[];
}

export interface ResourceResponse {
  environment: EnvironmentSummary;
  project: ProjectSummary;
  resource: ResourceSummary;
}

export interface ResourceLogLine {
  message: string;
  resourceName: string;
  stream: 'stdout' | 'stderr';
  timestamp: string;
}

export interface ResourceLogsResponse {
  environment: EnvironmentSummary;
  lines: ResourceLogLine[];
  project: ProjectSummary;
  resource: ResourceSummary;
}

export interface ResourceDeleteRequest {
  confirmation?: ResourceDeleteConfirmation | undefined;
  deleteData?: boolean | undefined;
}

export interface ResourceDeleteResponse {
  retainedVolumes: string[];
  success: true;
}

const resourceRuntimeStatusSchema: ContractSchema<ResourceRuntimeStatus> = z.enum(['running', 'stopped']);
const resourceEnvSourceTypeSchema: ContractSchema<ResourceEnvSourceType> = z.literal('literal');
const resourceReadinessSummarySchema: ContractSchema<ResourceReadinessSummary> = z
  .object({
    port: z.number().int().min(1).max(65_535),
    timeoutMs: z.number().int().positive().max(300_000),
    type: z.literal('tcp'),
  })
  .strict();
const resourceEnvSourceSummarySchema: ContractSchema<ResourceEnvSourceSummary> = z
  .object({
    keyName: z.string().min(1),
    sourceType: resourceEnvSourceTypeSchema,
    variableName: z.null(),
  })
  .strict();
export const resourceVolumeSummarySchema: ContractSchema<ResourceVolumeSummary> = z
  .object({
    mountPath: z.string().min(1),
    name: z.string().min(1),
  })
  .strict();

export const resourceSummarySchema: ContractSchema<ResourceSummary> = z
  .object({
    createdAt: z.string().datetime(),
    env: z.array(resourceEnvSourceSummarySchema),
    id: z.string().min(1),
    image: z.string().min(1),
    name: compartmentResourceNameSchema,
    ports: z.array(z.number().int().min(1).max(65_535)),
    readiness: resourceReadinessSummarySchema.nullable(),
    status: resourceRuntimeStatusSchema,
    updatedAt: z.string().datetime(),
    volumes: z.array(resourceVolumeSummarySchema),
  })
  .strict();

const resourceListQueryObjectSchema: z.ZodObject<{
  environmentName: z.ZodOptional<typeof environmentNameSchema>;
  projectName: typeof compartmentProjectNameSchema;
}> = z
  .object({
    environmentName: environmentNameSchema.optional(),
    projectName: compartmentProjectNameSchema,
  })
  .strict();

export const resourceListQuerySchema: ContractSchema<ResourceListQuery> = resourceListQueryObjectSchema;

const resourceTargetQueryObjectSchema: z.ZodObject<{
  environmentName: z.ZodOptional<typeof environmentNameSchema>;
  projectName: typeof compartmentProjectNameSchema;
  resourceName: typeof compartmentResourceNameSchema;
}> = resourceListQueryObjectSchema
  .extend({
    resourceName: compartmentResourceNameSchema,
  })
  .strict();

export const resourceTargetQuerySchema: ContractSchema<ResourceTargetQuery> = resourceTargetQueryObjectSchema;

const resourceOutputRevealQuerySchema: z.ZodOptional<
  z.ZodUnion<[z.ZodBoolean, z.ZodEffects<z.ZodEnum<['true', 'false']>, boolean, 'true' | 'false'>]>
> = z
  .union([z.boolean(), z.enum(['true', 'false']).transform((value: 'true' | 'false'): boolean => value === 'true')])
  .optional();

export const resourceOutputQuerySchema: ContractSchema<ResourceOutputQuery> = resourceTargetQueryObjectSchema
  .extend({
    outputName: compartmentResourceOutputNameSchema,
    reveal: resourceOutputRevealQuerySchema,
  })
  .strict() as never as ContractSchema<ResourceOutputQuery>;

export const resourceLogsQuerySchema: ContractSchema<ResourceLogsQuery> = resourceTargetQueryObjectSchema
  .extend({
    since: z.string().datetime().optional(),
    tailLines: z.coerce.number().int().positive().max(logTailLineLimit).optional(),
  })
  .strict();

export const resourceListResponseSchema: ContractSchema<ResourceListResponse> = z
  .object({
    environment: environmentSummarySchema,
    project: projectSummarySchema,
    resources: z.array(resourceSummarySchema),
  })
  .strict();

export const resourceResponseSchema: ContractSchema<ResourceResponse> = z
  .object({
    environment: environmentSummarySchema,
    project: projectSummarySchema,
    resource: resourceSummarySchema,
  })
  .strict();

const resourceLogLineSchema: ContractSchema<ResourceLogLine> = z
  .object({
    message: z.string(),
    resourceName: compartmentResourceNameSchema,
    stream: z.enum(['stdout', 'stderr']),
    timestamp: z.string().datetime(),
  })
  .strict();

export const resourceLogsResponseSchema: ContractSchema<ResourceLogsResponse> = z
  .object({
    environment: environmentSummarySchema,
    lines: z.array(resourceLogLineSchema),
    project: projectSummarySchema,
    resource: resourceSummarySchema,
  })
  .strict();

export const resourceDeleteRequestSchema: ContractSchema<ResourceDeleteRequest> = z
  .object({
    confirmation: z.literal('delete-resource-data').optional(),
    deleteData: z.boolean().optional(),
  })
  .strict()
  .superRefine((request: ResourceDeleteRequest, context: z.RefinementCtx): void => {
    if (request.deleteData !== true || request.confirmation === 'delete-resource-data') {
      return;
    }

    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Resource data deletion requires confirmation.',
      path: ['confirmation'],
    });
  });

export const resourceDeleteResponseSchema: ContractSchema<ResourceDeleteResponse> = z
  .object({
    retainedVolumes: z.array(z.string().min(1)),
    success: z.literal(true),
  })
  .strict();
