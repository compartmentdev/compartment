import { z, type ZodType } from 'zod';
import {
  importVariablesRequestSchema,
  type ImportVariablesRequest,
  setVariableRequestSchema,
  type VariableLocalRunRequest,
  variableLocalRunRequestSchema,
  variableKeyNameSchema,
  variableTargetQuerySchema,
  type SetVariableRequest,
  type VariableTargetQuery,
} from '@compartment/contracts';

export interface VariableRouteParams {
  keyName: string;
}

export const variableRouteParamsSchema: ZodType<VariableRouteParams> = z
  .object({
    keyName: variableKeyNameSchema,
  })
  .strict();

export const variableQuerySchema: typeof variableTargetQuerySchema = variableTargetQuerySchema;
export const variableSetRequestSchema: typeof setVariableRequestSchema = setVariableRequestSchema;
export const variableImportRequestSchema: typeof importVariablesRequestSchema = importVariablesRequestSchema;
export const variableLocalRunBodySchema: typeof variableLocalRunRequestSchema = variableLocalRunRequestSchema;
export type { ImportVariablesRequest, SetVariableRequest, VariableLocalRunRequest, VariableTargetQuery };
