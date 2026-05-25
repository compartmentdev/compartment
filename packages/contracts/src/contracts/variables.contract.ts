import { z } from 'zod';
import { defaultCompartmentEnvironmentName } from './deployments.contract';
import { environmentNameSchema, environmentSummarySchema, type EnvironmentSummary } from './environments.contract';
import {
  compartmentProjectNameSchema,
  compartmentResourceNameSchema,
  compartmentServiceNameSchema,
} from './compartment-descriptor.contract';
import { projectSummarySchema, type ProjectSummary } from './projects.contract';
import { variableLocalRunCommandNameSchema } from './variable-local-run-command';
import { variableKeyNameSchema } from './variable-key.contract';
import { assertUniqueVariableImportEntries, assertVariableTargetSelection } from './variable-target.contract';
import type { ContractSchema } from './schema.types';

export { variableKeyNameSchema };

export type VariableSensitivity = 'plain' | 'sensitive';
export type VariableScopeType = 'environment' | 'resource' | 'service';
export type VariableSourceType = 'direct' | 'inherited' | 'resource_output' | 'set';

export interface VariableTargetQuery {
  environmentName?: string | undefined;
  projectName: string;
  resourceName?: string | undefined;
  serviceName?: string | undefined;
}

export interface VariableImportEntry {
  keyName: string;
  value: string;
}

export interface ImportVariablesRequest extends VariableTargetQuery {
  entries: VariableImportEntry[];
  replace?: boolean | undefined;
  sensitivity?: VariableSensitivity | undefined;
}

export interface VariableListItem {
  keyName: string;
  scopeResourceName: string | null;
  scopeServiceName: string | null;
  scopeType: VariableScopeType;
  sensitivity: VariableSensitivity;
  sourceResourceOutput: string | null;
  sourceType: VariableSourceType;
  sourceVariableSetName: string | null;
}

export interface VariableDetail extends VariableListItem {
  value: string | null;
  valueHidden: boolean;
}

export interface VariableListResponse {
  environment: EnvironmentSummary;
  project: ProjectSummary;
  resourceName: string | null;
  serviceName: string | null;
  variables: VariableListItem[];
}

export interface VariableResponse {
  environment: EnvironmentSummary;
  project: ProjectSummary;
  resourceName: string | null;
  serviceName: string | null;
  variable: VariableDetail;
}

export interface VariableLocalRunRequest {
  commandName?: string | null | undefined;
  environmentName: string;
  productionAck: boolean;
  projectName: string;
  resourceName?: string | null | undefined;
  serviceName: string | null;
}

export interface VariableLocalRunItem extends VariableListItem {
  value: string;
  valueFingerprint: string;
}

export interface VariableLocalRunResponse {
  accessEventId: string;
  environment: EnvironmentSummary;
  project: ProjectSummary;
  resourceName: string | null;
  serviceName: string | null;
  variables: VariableLocalRunItem[];
}

export interface RemoveVariableResponse {
  success: true;
}

export interface ImportVariablesResponse {
  environment: EnvironmentSummary;
  importedKeyNames: string[];
  project: ProjectSummary;
  resourceName: string | null;
  serviceName: string | null;
}

export const variableSensitivitySchema: ContractSchema<VariableSensitivity> = z.enum(['plain', 'sensitive']);
const variableScopeTypeSchema: ContractSchema<VariableScopeType> = z.enum(['environment', 'resource', 'service']);
const variableSourceTypeSchema: ContractSchema<VariableSourceType> = z.enum([
  'direct',
  'inherited',
  'resource_output',
  'set',
]);
const variableValueFingerprintSchema: ContractSchema<string> = z.string().regex(/^[0-9a-f]{64}$/u);
type VariableTargetQueryObjectSchema = z.ZodObject<{
  environmentName: z.ZodOptional<typeof environmentNameSchema>;
  projectName: typeof compartmentProjectNameSchema;
  resourceName: z.ZodOptional<typeof compartmentResourceNameSchema>;
  serviceName: z.ZodOptional<typeof compartmentServiceNameSchema>;
}>;
type VariableListItemObjectSchema = z.ZodObject<
  {
    keyName: typeof variableKeyNameSchema;
    scopeResourceName: z.ZodNullable<typeof compartmentResourceNameSchema>;
    scopeServiceName: z.ZodNullable<typeof compartmentServiceNameSchema>;
    scopeType: typeof variableScopeTypeSchema;
    sensitivity: typeof variableSensitivitySchema;
    sourceResourceOutput: z.ZodNullable<z.ZodString>;
    sourceType: typeof variableSourceTypeSchema;
    sourceVariableSetName: z.ZodNullable<z.ZodString>;
  },
  'strict'
>;

export const variableTargetQuerySchema: VariableTargetQueryObjectSchema = z
  .object({
    environmentName: environmentNameSchema.optional(),
    projectName: compartmentProjectNameSchema,
    resourceName: compartmentResourceNameSchema.optional(),
    serviceName: compartmentServiceNameSchema.optional(),
  })
  .strict();

const variableImportEntrySchema: ContractSchema<VariableImportEntry> = z
  .object({
    keyName: variableKeyNameSchema,
    value: z.string(),
  })
  .strict();

export const importVariablesRequestSchema: ContractSchema<ImportVariablesRequest> = variableTargetQuerySchema
  .extend({
    entries: z.array(variableImportEntrySchema).min(1),
    replace: z.boolean().optional(),
    sensitivity: variableSensitivitySchema.optional(),
  })
  .strict()
  .superRefine(assertVariableTargetSelection)
  .superRefine(assertUniqueVariableImportEntries);

const variableListItemObjectSchema: VariableListItemObjectSchema = z
  .object({
    keyName: variableKeyNameSchema,
    scopeResourceName: compartmentResourceNameSchema.nullable(),
    scopeServiceName: compartmentServiceNameSchema.nullable(),
    scopeType: variableScopeTypeSchema,
    sensitivity: variableSensitivitySchema,
    sourceResourceOutput: z.string().min(1).nullable(),
    sourceType: variableSourceTypeSchema,
    sourceVariableSetName: z.string().min(1).nullable(),
  })
  .strict();
const variableListItemSchema: ContractSchema<VariableListItem> = variableListItemObjectSchema;

const variableDetailSchema: ContractSchema<VariableDetail> = variableListItemObjectSchema
  .extend({
    value: z.string().nullable(),
    valueHidden: z.boolean(),
  })
  .strict();

export const variableListResponseSchema: ContractSchema<VariableListResponse> = z
  .object({
    environment: environmentSummarySchema,
    project: projectSummarySchema,
    resourceName: compartmentResourceNameSchema.nullable(),
    serviceName: compartmentServiceNameSchema.nullable(),
    variables: z.array(variableListItemSchema),
  })
  .strict();

export const variableResponseSchema: ContractSchema<VariableResponse> = z
  .object({
    environment: environmentSummarySchema,
    project: projectSummarySchema,
    resourceName: compartmentResourceNameSchema.nullable(),
    serviceName: compartmentServiceNameSchema.nullable(),
    variable: variableDetailSchema,
  })
  .strict();

const variableLocalRunItemSchema: ContractSchema<VariableLocalRunItem> = variableListItemObjectSchema
  .extend({
    value: z.string(),
    valueFingerprint: variableValueFingerprintSchema,
  })
  .strict();

export const variableLocalRunRequestSchema: ContractSchema<VariableLocalRunRequest> = z
  .object({
    commandName: variableLocalRunCommandNameSchema.nullable().optional(),
    environmentName: environmentNameSchema,
    productionAck: z.boolean(),
    projectName: compartmentProjectNameSchema,
    resourceName: compartmentResourceNameSchema.nullable().optional(),
    serviceName: compartmentServiceNameSchema.nullable(),
  })
  .strict()
  .superRefine((value: VariableLocalRunRequest, context: z.RefinementCtx): void => {
    assertVariableTargetSelection(value, context);
    const productionTarget: boolean = value.environmentName === defaultCompartmentEnvironmentName;
    if (value.productionAck !== productionTarget) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: productionTarget
          ? 'productionAck is required for production variable runs.'
          : 'productionAck must be false for non-production variable runs.',
        path: ['productionAck'],
      });
    }
  });

export const variableLocalRunResponseSchema: ContractSchema<VariableLocalRunResponse> = z
  .object({
    accessEventId: z.string().min(1),
    environment: environmentSummarySchema,
    project: projectSummarySchema,
    resourceName: compartmentResourceNameSchema.nullable(),
    serviceName: compartmentServiceNameSchema.nullable(),
    variables: z.array(variableLocalRunItemSchema),
  })
  .strict();

export const removeVariableResponseSchema: ContractSchema<RemoveVariableResponse> = z
  .object({
    success: z.literal(true),
  })
  .strict();

export const importVariablesResponseSchema: ContractSchema<ImportVariablesResponse> = z
  .object({
    environment: environmentSummarySchema,
    importedKeyNames: z.array(variableKeyNameSchema),
    project: projectSummarySchema,
    resourceName: compartmentResourceNameSchema.nullable(),
    serviceName: compartmentServiceNameSchema.nullable(),
  })
  .strict();
