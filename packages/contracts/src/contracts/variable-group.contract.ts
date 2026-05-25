import { z } from 'zod';
import {
  compartmentProjectNamePatternText,
  compartmentProjectNameSchema,
  compartmentResourceNameSchema,
  compartmentServiceNameSchema,
} from './compartment-descriptor.contract';
import { environmentNameSchema, environmentSummarySchema, type EnvironmentSummary } from './environments.contract';
import { projectSummarySchema, type ProjectSummary } from './projects.contract';
import type { ContractSchema } from './schema.types';
import { assertUniqueVariableImportEntries, assertVariableTargetSelection } from './variable-target.contract';
import { variableKeyNameSchema } from './variable-key.contract';
import {
  variableTargetQuerySchema,
  type VariableImportEntry,
  type VariableSensitivity,
  type VariableTargetQuery,
} from './variables.contract';

const variableGroupNamePattern: RegExp = new RegExp(compartmentProjectNamePatternText, 'u');

export const variableGroupNameSchema: ContractSchema<string> = z.string().regex(variableGroupNamePattern);

export interface CreateVariableGroupRequest {
  description?: string | undefined;
  variableGroupName: string;
}

export type VariableGroupImportEntry = VariableImportEntry;

export interface PutVariableGroupVariableRequest {
  keyName: string;
  sensitivity?: VariableSensitivity | undefined;
  value: string;
  variableGroupName: string;
}

export interface ImportVariableGroupRequest {
  entries: VariableGroupImportEntry[];
  replace?: boolean | undefined;
  sensitivity?: VariableSensitivity | undefined;
  variableGroupName: string;
}

export interface CaptureVariableGroupRequest extends VariableTargetQuery {
  effective?: boolean | undefined;
  variableGroupName: string;
}

export interface VariableGroupVariable {
  keyName: string;
  sensitivity: VariableSensitivity;
}

export interface VariableGroupSummary {
  createdAt: string;
  description: string | null;
  name: string;
  updatedAt: string;
  variableCount: number;
}

export interface VariableGroupDetail extends VariableGroupSummary {
  variables: VariableGroupVariable[];
}

export interface VariableGroupResponse {
  variableGroup: VariableGroupDetail;
}

export interface VariableGroupListResponse {
  variableGroups: VariableGroupSummary[];
}

export interface ImportVariableGroupResponse {
  importedKeyNames: string[];
  variableGroup: VariableGroupDetail;
}

export interface CaptureVariableGroupResponse {
  capturedKeyNames: string[];
  environment: EnvironmentSummary;
  project: ProjectSummary;
  resourceName: string | null;
  serviceName: string | null;
  variableGroup: VariableGroupDetail;
}

export interface VariableGroupUsage {
  environmentName: string;
  projectName: string;
  resourceName: string | null;
  serviceName: string | null;
}

export interface VariableGroupUsagesResponse {
  usages: VariableGroupUsage[];
  variableGroup: VariableGroupSummary;
}

export interface VariableGroupBindingRequest extends VariableTargetQuery {
  variableGroupName: string;
}

export interface VariableGroupBindingResponse {
  environment: EnvironmentSummary;
  project: ProjectSummary;
  resourceName: string | null;
  serviceName: string | null;
  variableGroupName: string;
}

const variableSensitivitySchema: ContractSchema<VariableSensitivity> = z.enum(['plain', 'sensitive']);
const variableGroupDescriptionSchema: ContractSchema<string> = z.string().trim().min(1);
const variableGroupImportEntrySchema: ContractSchema<VariableGroupImportEntry> = z
  .object({
    keyName: variableKeyNameSchema,
    value: z.string(),
  })
  .strict();

export const createVariableGroupRequestSchema: ContractSchema<CreateVariableGroupRequest> = z
  .object({
    description: variableGroupDescriptionSchema.optional(),
    variableGroupName: variableGroupNameSchema,
  })
  .strict();

export const putVariableGroupVariableRequestSchema: ContractSchema<PutVariableGroupVariableRequest> = z
  .object({
    keyName: variableKeyNameSchema,
    sensitivity: variableSensitivitySchema.optional(),
    value: z.string(),
    variableGroupName: variableGroupNameSchema,
  })
  .strict();

export const importVariableGroupRequestSchema: ContractSchema<ImportVariableGroupRequest> = z
  .object({
    entries: z.array(variableGroupImportEntrySchema).min(1),
    replace: z.boolean().optional(),
    sensitivity: variableSensitivitySchema.optional(),
    variableGroupName: variableGroupNameSchema,
  })
  .strict()
  .superRefine(assertUniqueVariableImportEntries);

export const captureVariableGroupRequestSchema: ContractSchema<CaptureVariableGroupRequest> = variableTargetQuerySchema
  .extend({
    effective: z.boolean().optional(),
    variableGroupName: variableGroupNameSchema,
  })
  .strict()
  .superRefine(assertVariableTargetSelection);

const variableGroupVariableSchema: ContractSchema<VariableGroupVariable> = z
  .object({
    keyName: variableKeyNameSchema,
    sensitivity: variableSensitivitySchema,
  })
  .strict();

const variableGroupSummaryObjectSchema: z.ZodObject<{
  createdAt: z.ZodString;
  description: z.ZodNullable<z.ZodString>;
  name: typeof variableGroupNameSchema;
  updatedAt: z.ZodString;
  variableCount: z.ZodNumber;
}> = z
  .object({
    createdAt: z.string().datetime(),
    description: z.string().min(1).nullable(),
    name: variableGroupNameSchema,
    updatedAt: z.string().datetime(),
    variableCount: z.number().int().min(0),
  })
  .strict();
const variableGroupSummarySchema: ContractSchema<VariableGroupSummary> = variableGroupSummaryObjectSchema;

const variableGroupDetailSchema: ContractSchema<VariableGroupDetail> = variableGroupSummaryObjectSchema
  .extend({
    variables: z.array(variableGroupVariableSchema),
  })
  .strict();

export const variableGroupResponseSchema: ContractSchema<VariableGroupResponse> = z
  .object({
    variableGroup: variableGroupDetailSchema,
  })
  .strict();

export const variableGroupListResponseSchema: ContractSchema<VariableGroupListResponse> = z
  .object({
    variableGroups: z.array(variableGroupSummarySchema),
  })
  .strict();

export const importVariableGroupResponseSchema: ContractSchema<ImportVariableGroupResponse> = z
  .object({
    importedKeyNames: z.array(variableKeyNameSchema),
    variableGroup: variableGroupDetailSchema,
  })
  .strict();

export const captureVariableGroupResponseSchema: ContractSchema<CaptureVariableGroupResponse> = z
  .object({
    capturedKeyNames: z.array(variableKeyNameSchema),
    environment: environmentSummarySchema,
    project: projectSummarySchema,
    resourceName: compartmentResourceNameSchema.nullable(),
    serviceName: compartmentServiceNameSchema.nullable(),
    variableGroup: variableGroupDetailSchema,
  })
  .strict();

const variableGroupUsageSchema: ContractSchema<VariableGroupUsage> = z
  .object({
    environmentName: environmentNameSchema,
    projectName: compartmentProjectNameSchema,
    resourceName: compartmentResourceNameSchema.nullable(),
    serviceName: compartmentServiceNameSchema.nullable(),
  })
  .strict();

export const variableGroupUsagesResponseSchema: ContractSchema<VariableGroupUsagesResponse> = z
  .object({
    usages: z.array(variableGroupUsageSchema),
    variableGroup: variableGroupSummarySchema,
  })
  .strict();

export const variableGroupBindingRequestSchema: ContractSchema<VariableGroupBindingRequest> = variableTargetQuerySchema
  .extend({
    variableGroupName: variableGroupNameSchema,
  })
  .strict()
  .superRefine(assertVariableTargetSelection);

export const variableGroupBindingResponseSchema: ContractSchema<VariableGroupBindingResponse> = z
  .object({
    environment: environmentSummarySchema,
    project: projectSummarySchema,
    resourceName: compartmentResourceNameSchema.nullable(),
    serviceName: compartmentServiceNameSchema.nullable(),
    variableGroupName: variableGroupNameSchema,
  })
  .strict();
