import { z } from 'zod';
import { compartmentResourceNameSchema } from './compartment-descriptor.contract';
import { compartmentResourceOutputNameSchema } from './compartment-resource.contract';
import { variableKeyNameSchema } from './variable-key.contract';
import { assertVariableTargetSelection } from './variable-target.contract';
import {
  variableSensitivitySchema,
  variableTargetQuerySchema,
  type VariableSensitivity,
  type VariableTargetQuery,
} from './variables.contract';
import type { ContractSchema } from './schema.types';

export interface SetVariableRequest extends VariableTargetQuery {
  fromResource?: string | undefined;
  keyName: string;
  sensitivity?: VariableSensitivity | undefined;
  value?: string | undefined;
}

export interface ResourceOutputReference {
  outputName: string;
  resourceName: string;
}

const resourceOutputReferenceSchema: ContractSchema<string> = z
  .string()
  .refine((reference: string): boolean => parseResourceOutputReference(reference) !== null, {
    message: 'Resource output reference must use resource.output.',
  });

export function parseResourceOutputReference(reference: string): ResourceOutputReference | null {
  const separatorIndex: number = reference.indexOf('.');
  if (separatorIndex === -1) {
    return null;
  }
  const resourceName: string = reference.slice(0, separatorIndex);
  const outputName: string = reference.slice(separatorIndex + 1);
  if (
    !compartmentResourceNameSchema.safeParse(resourceName).success ||
    !compartmentResourceOutputNameSchema.safeParse(outputName).success
  ) {
    return null;
  }

  return {
    outputName,
    resourceName,
  };
}

export function buildResourceOutputReference(reference: ResourceOutputReference): string {
  return `${reference.resourceName}.${reference.outputName}`;
}

export const setVariableRequestSchema: ContractSchema<SetVariableRequest> = variableTargetQuerySchema
  .extend({
    fromResource: resourceOutputReferenceSchema.optional(),
    keyName: variableKeyNameSchema,
    sensitivity: variableSensitivitySchema.optional(),
    value: z.string().optional(),
  })
  .strict()
  .superRefine(assertVariableTargetSelection)
  .superRefine((request: SetVariableRequest, context: z.RefinementCtx): void => {
    assertSetVariableValueSource(request, context);
    assertSetVariableResourceOutputTarget(request, context);
  });

function assertSetVariableValueSource(request: SetVariableRequest, context: z.RefinementCtx): void {
  if ((request.value === undefined) !== (request.fromResource === undefined)) {
    return;
  }

  context.addIssue({
    code: z.ZodIssueCode.custom,
    message: 'Set exactly one of value or fromResource.',
    path: ['value'],
  });
}

function assertSetVariableResourceOutputTarget(request: SetVariableRequest, context: z.RefinementCtx): void {
  if (request.fromResource === undefined) {
    return;
  }
  if (request.serviceName === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'fromResource requires serviceName.',
      path: ['serviceName'],
    });
  }
  if (request.sensitivity === undefined) {
    return;
  }

  context.addIssue({
    code: z.ZodIssueCode.custom,
    message: 'fromResource bindings derive sensitivity from the resource output.',
    path: ['sensitivity'],
  });
}
