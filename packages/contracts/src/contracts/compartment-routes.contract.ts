import { z } from 'zod';
import {
  readContractShapeFieldNames,
  readRequiredContractShapeFieldNames,
  type ContractObjectShape,
} from './contract-shape';
import {
  compartmentRoutePathFormValues,
  compartmentRouteTransformFieldValues,
  compartmentRoutesExampleYaml,
  compartmentRoutesFileName,
  compartmentRoutesLocation,
  compartmentRoutesMatchingSemantics,
  compartmentRoutesRelatedFiles,
  compartmentRoutesTransformSemantics,
  compartmentRoutesValidationNotes,
} from './compartment-routes-guide.contract';
import {
  compartmentRouteMethodValues,
  createCompartmentRouteRuleShape,
  type CompartmentRouteMethod,
  type CompartmentRoutePathForm,
  type CompartmentRouteRule,
  type CompartmentRouteTransformField,
  validateCompartmentRouteRule,
} from './compartment-route-rule.contract';
import type { ContractSchema } from './schema.types';

export {
  matchCompartmentRoute,
  type CompartmentRouteMatch,
  type CompartmentRouteMethod,
  type CompartmentRoutePathForm,
  type CompartmentRouteRequestPath,
  type CompartmentRouteRule,
  type CompartmentRouteTransformField,
} from './compartment-route-rule.contract';

export interface CompartmentRoutesFile {
  routes: CompartmentRouteRule[];
  version: 1;
}

export interface CompartmentRoutesSchemaRules {
  maxTransformsPerRoute: number;
  methodsOptional: boolean;
  requiredRouteFields: string[];
  routeFields: string[];
  routePathForms: CompartmentRoutePathForm[];
  routeTransformFields: CompartmentRouteTransformField[];
  routesMustNotBeEmpty: boolean;
  supportedHttpMethods: CompartmentRouteMethod[];
  version: 1;
}

export interface CompartmentRoutesSchemaResponse {
  createdByInit: false;
  currentValidationNotes: string[];
  exampleYaml: string;
  fileName: string;
  location: string;
  matchingSemantics: string[];
  optional: true;
  relatedFiles: string[];
  rules: CompartmentRoutesSchemaRules;
  transformSemantics: string[];
}

const compartmentRouteRuleShape: ContractObjectShape = createCompartmentRouteRuleShape();
const compartmentRoutesRequiredRouteFieldNames: string[] =
  readRequiredContractShapeFieldNames(compartmentRouteRuleShape);
const compartmentRoutesRouteFieldNames: string[] = readContractShapeFieldNames(compartmentRouteRuleShape);
const compartmentRoutesSchemaRulesSchema: ContractSchema<CompartmentRoutesSchemaRules> = z
  .object({
    maxTransformsPerRoute: z.literal(1),
    methodsOptional: z.literal(true),
    requiredRouteFields: z.array(z.string().min(1)).min(1),
    routeFields: z.array(z.string().min(1)).min(1),
    routePathForms: z.array(z.enum(compartmentRoutePathFormValues)).min(1),
    routeTransformFields: z.array(z.enum(compartmentRouteTransformFieldValues)).min(1),
    routesMustNotBeEmpty: z.literal(true),
    supportedHttpMethods: z.array(z.enum(compartmentRouteMethodValues)).min(1),
    version: z.literal(1),
  })
  .strict();

export const compartmentRouteRuleSchema: ContractSchema<CompartmentRouteRule> = z
  .object(createCompartmentRouteRuleShape())
  .strict()
  .superRefine(validateCompartmentRouteRule) as ContractSchema<CompartmentRouteRule>;

export const compartmentRouteRulesSchema: ContractSchema<CompartmentRouteRule[]> = z.array(compartmentRouteRuleSchema);

export const compartmentRoutesFileSchema: ContractSchema<CompartmentRoutesFile> = z
  .object({
    routes: z.array(compartmentRouteRuleSchema).min(1),
    version: z.literal(1),
  })
  .strict();

export const compartmentRoutesSchemaResponseSchema: ContractSchema<CompartmentRoutesSchemaResponse> = z
  .object({
    createdByInit: z.literal(false),
    currentValidationNotes: z.array(z.string().min(1)).min(1),
    exampleYaml: z.string().min(1),
    fileName: z.string().min(1),
    location: z.string().min(1),
    matchingSemantics: z.array(z.string().min(1)).min(1),
    optional: z.literal(true),
    relatedFiles: z.array(z.string().min(1)).min(1),
    rules: compartmentRoutesSchemaRulesSchema,
    transformSemantics: z.array(z.string().min(1)).min(1),
  })
  .strict();

export function createCompartmentRoutesSchemaResponse(): CompartmentRoutesSchemaResponse {
  return compartmentRoutesSchemaResponseSchema.parse({
    createdByInit: false,
    currentValidationNotes: [...compartmentRoutesValidationNotes],
    exampleYaml: compartmentRoutesExampleYaml,
    fileName: compartmentRoutesFileName,
    location: compartmentRoutesLocation,
    matchingSemantics: [...compartmentRoutesMatchingSemantics],
    optional: true,
    relatedFiles: [...compartmentRoutesRelatedFiles],
    rules: {
      maxTransformsPerRoute: 1,
      methodsOptional: true,
      requiredRouteFields: [...compartmentRoutesRequiredRouteFieldNames],
      routeFields: [...compartmentRoutesRouteFieldNames],
      routePathForms: [...compartmentRoutePathFormValues],
      routeTransformFields: [...compartmentRouteTransformFieldValues],
      routesMustNotBeEmpty: true,
      supportedHttpMethods: [...compartmentRouteMethodValues],
      version: 1,
    },
    transformSemantics: [...compartmentRoutesTransformSemantics],
  });
}
