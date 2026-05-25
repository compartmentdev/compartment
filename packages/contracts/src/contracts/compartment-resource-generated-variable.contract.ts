import { z } from 'zod';
import type {
  CompartmentResourceGeneratedVariableConfig,
  CompartmentResourceGeneratedVariableEncoding,
  CompartmentResourceGeneratedVariableGenerator,
} from './compartment-descriptor.types';
import type { CompartmentAuthoredResourceConfigRawInput } from './compartment-resource-preset.contract';
import type { ContractSchema } from './schema.types';
import { variableKeyNameSchema } from './variable-key.contract';

export const compartmentResourceGeneratedVariableFieldNames: readonly ['generator', 'bytes', 'encoding'] = [
  'generator',
  'bytes',
  'encoding',
];
export const resourceGeneratedVariableTokenDefaultBytes: number = 24;
const resourceGeneratedVariableTokenMinBytes: number = 16;
const resourceGeneratedVariableTokenMaxBytes: number = 128;
export const resourceGeneratedVariableTokenDefaultEncoding: CompartmentResourceGeneratedVariableEncoding = 'hex';
const compartmentResourceGeneratedVariableEncodingValues: readonly [
  CompartmentResourceGeneratedVariableEncoding,
  CompartmentResourceGeneratedVariableEncoding,
] = ['hex', 'base64url'];
const compartmentResourceGeneratedVariableGeneratorValues: readonly [CompartmentResourceGeneratedVariableGenerator] = [
  'token',
];

const compartmentResourceGeneratedVariableConfigSchema: ContractSchema<CompartmentResourceGeneratedVariableConfig> = z
  .object({
    bytes: z
      .number()
      .int()
      .min(resourceGeneratedVariableTokenMinBytes)
      .max(resourceGeneratedVariableTokenMaxBytes)
      .optional(),
    encoding: z.enum(compartmentResourceGeneratedVariableEncodingValues).optional(),
    generator: z.enum(compartmentResourceGeneratedVariableGeneratorValues),
  })
  .strict();

export const compartmentResourceGeneratedVariablesSchema: ContractSchema<
  Record<string, CompartmentResourceGeneratedVariableConfig>
> = z.record(variableKeyNameSchema, compartmentResourceGeneratedVariableConfigSchema);

export function readCompartmentResourceGeneratedVariableGenerators(): [CompartmentResourceGeneratedVariableGenerator] {
  return [...compartmentResourceGeneratedVariableGeneratorValues];
}

export function readCompartmentResourceGeneratedVariableEncodings(): [
  CompartmentResourceGeneratedVariableEncoding,
  CompartmentResourceGeneratedVariableEncoding,
] {
  return [...compartmentResourceGeneratedVariableEncodingValues];
}

export function validateCompartmentResourceGeneratedVariables(
  resource: CompartmentAuthoredResourceConfigRawInput,
  context: z.RefinementCtx,
): void {
  for (const keyName of Object.keys(resource.generatedVariables ?? {})) {
    if (resource.env?.[keyName] === undefined) {
      continue;
    }

    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Resource generated variable "${keyName}" conflicts with literal resource env "${keyName}".`,
      path: ['generatedVariables', keyName],
    });
  }
}
