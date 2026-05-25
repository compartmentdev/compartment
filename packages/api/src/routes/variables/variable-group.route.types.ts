import { z, type ZodType } from 'zod';
import {
  captureVariableGroupRequestSchema,
  createVariableGroupRequestSchema,
  importVariableGroupRequestSchema,
  putVariableGroupVariableRequestSchema,
  variableGroupNameSchema,
  type CaptureVariableGroupRequest,
  type CreateVariableGroupRequest,
  type ImportVariableGroupRequest,
  type PutVariableGroupVariableRequest,
} from '@compartment/contracts';

export interface VariableGroupRouteParams {
  variableGroupName: string;
}

export const variableGroupRouteParamsSchema: ZodType<VariableGroupRouteParams> = z
  .object({
    variableGroupName: variableGroupNameSchema,
  })
  .strict();

export const createVariableGroupBodySchema: typeof createVariableGroupRequestSchema = createVariableGroupRequestSchema;
export const putVariableGroupVariableBodySchema: typeof putVariableGroupVariableRequestSchema =
  putVariableGroupVariableRequestSchema;
export const importVariableGroupBodySchema: typeof importVariableGroupRequestSchema = importVariableGroupRequestSchema;
export const captureVariableGroupBodySchema: typeof captureVariableGroupRequestSchema =
  captureVariableGroupRequestSchema;

export type {
  CaptureVariableGroupRequest,
  CreateVariableGroupRequest,
  ImportVariableGroupRequest,
  PutVariableGroupVariableRequest,
};
