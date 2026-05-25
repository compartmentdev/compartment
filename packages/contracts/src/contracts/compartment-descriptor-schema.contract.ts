import { z } from 'zod';
import {
  compartmentServiceBuildFieldNames,
  compartmentServiceBuildStrategySchema,
  compartmentServiceBuildStrategyValues,
  resolveCompartmentServiceBuildConfig,
  resolvedCompartmentServiceBuildConfigSchema,
} from './service-build.contract';
import { compartmentServiceKindValues, resolveCompartmentServiceKind } from './compartment-service-kind.contract';
import {
  compartmentServiceReadinessFieldNames,
  compartmentServiceReadinessTypeValues,
  resolvedOptionalServiceReadinessConfigSchema,
  resolveServiceReadinessConfig,
} from './service-readiness.contract';
import {
  compartmentServiceReleaseFieldNames,
  resolvedOptionalCompartmentServiceReleaseConfigSchema,
  resolveCompartmentServiceReleaseConfig,
} from './service-release.contract';
import {
  compartmentServiceRestartFieldNames,
  compartmentServiceRestartMaxRetriesPolicyValues,
  compartmentServiceRestartPolicyValues,
  compartmentServiceRunFieldNames,
  resolveCompartmentServiceRunConfig,
  resolvedCompartmentServiceRunConfigSchema,
} from './service-run.contract';
import { staticCompartmentServiceKind, staticCompartmentServiceOutputDirectoryRule } from './service-static.contract';
import {
  compartmentDescriptorDoesNotOwn,
  compartmentDescriptorExpandedExampleYaml,
  compartmentDescriptorFileName,
  compartmentDescriptorLocation,
  compartmentDescriptorMinimalExampleYaml,
  compartmentDescriptorOwns,
  compartmentDescriptorRelatedFiles,
  type CompartmentDescriptorRelatedFile,
} from './compartment-descriptor-guide.contract';
import {
  createCompartmentDescriptorResourceRules,
  type CompartmentDescriptorResourceRules,
} from './compartment-descriptor-resource-rules.contract';
import { createCompartmentDescriptorServiceConnectionRules } from './compartment-descriptor-service-connection-rules.contract';
import { readCompartmentResourceOperationScheduleIntervals } from './compartment-resource.contract';
import { compartmentResourcePresetValues } from './compartment-resource-preset.contract';
import {
  compartmentDescriptorRequiredServiceConfigFieldNames,
  compartmentDescriptorServiceConfigFieldNames,
  compartmentReservedProjectNames,
  compartmentDescriptorServiceValueFormValues,
  compartmentProjectNamePatternText,
  compartmentServiceNamePatternText,
} from './compartment-descriptor.contract';
import type {
  CompartmentDescriptorSchemaDefaults,
  CompartmentDescriptorSchemaResponse,
  CompartmentDescriptorSchemaRules,
} from './compartment-descriptor.types';
import type { ContractSchema } from './schema.types';

const compartmentDescriptorSchemaDefaultsSchema: ContractSchema<CompartmentDescriptorSchemaDefaults> = z
  .object({
    readiness: resolvedOptionalServiceReadinessConfigSchema,
    resourceReadiness: z
      .object({
        port: z.number().int().min(1).max(65_535),
        timeoutMs: z.number().int().positive().max(300_000),
        type: z.literal('tcp'),
      })
      .strict()
      .nullable(),
    resourceRestart: z
      .object({
        policy: z.enum(compartmentServiceRestartPolicyValues),
      })
      .strict(),
    serviceBuild: resolvedCompartmentServiceBuildConfigSchema,
    serviceKind: z.enum(compartmentServiceKindValues),
    serviceRelease: resolvedOptionalCompartmentServiceReleaseConfigSchema,
    serviceRun: resolvedCompartmentServiceRunConfigSchema,
  })
  .strict();

const compartmentDescriptorRelatedFileSchema: ContractSchema<CompartmentDescriptorRelatedFile> = z
  .object({
    fileName: z.string().min(1),
    purpose: z.string().min(1),
  })
  .strict();

const compartmentDescriptorSchemaRulesSchema: ContractSchema<CompartmentDescriptorSchemaRules> = z
  .object({
    buildFields: z.array(z.string().min(1)).min(1),
    buildOutputDirectoryAllowedKinds: z.array(z.enum(compartmentServiceKindValues)),
    buildOutputDirectoryPathRule: z.string().min(1),
    buildOutputDirectoryRequiredKinds: z.array(z.enum(compartmentServiceKindValues)),
    dockerfileIgnoredKinds: z.array(z.enum(compartmentServiceKindValues)),
    buildStrategyForbiddenKinds: z.array(z.enum(compartmentServiceKindValues)),
    buildStrategies: z.array(compartmentServiceBuildStrategySchema).min(1),
    projectNamePattern: z.string().min(1),
    projectReservedNames: z.array(z.string().min(1)),
    readinessFields: z.array(z.string().min(1)).min(1),
    readinessForbiddenKinds: z.array(z.enum(compartmentServiceKindValues)),
    readinessTypes: z.array(z.enum(compartmentServiceReadinessTypeValues)).min(1),
    releaseFields: z.array(z.string().min(1)).min(1),
    releaseForbiddenKinds: z.array(z.enum(compartmentServiceKindValues)),
    resourceConfigFields: z.array(z.string().min(1)).min(1),
    resourceConfigRequiredFieldSets: z.array(z.array(z.string().min(1)).min(1)).min(1),
    resourceGeneratedVariableEncodings: z.array(z.enum(['hex', 'base64url'])).length(2),
    resourceGeneratedVariableFields: z.array(z.enum(['generator', 'bytes', 'encoding'])).length(3),
    resourceGeneratedVariableGenerators: z.array(z.literal('token')).length(1),
    resourceOperationFields: z.array(z.string().min(1)).min(1),
    resourceOperationRetentionFields: z.array(z.string().min(1)).min(1),
    resourceOperationScheduleFields: z.array(z.string().min(1)).min(1),
    resourceOperationScheduleIntervals: z.array(z.enum(readCompartmentResourceOperationScheduleIntervals())).min(1),
    resourceOutputFields: z.array(z.string().min(1)).min(1),
    resourceOutputNamePattern: z.string().min(1),
    resourcePresetRules: z
      .object({
        postgres: z
          .object({
            overrideFields: z.array(z.string().min(1)),
          })
          .strict(),
      })
      .strict(),
    resourcePresets: z.array(z.enum(compartmentResourcePresetValues)).min(1),
    resourceReadinessFields: z.array(z.string().min(1)).min(1),
    resourceReadinessTypes: z.array(z.literal('tcp')).length(1),
    resourceRestartFields: z.array(z.string().min(1)).min(1),
    resourceRestartPolicies: z.array(z.enum(compartmentServiceRestartPolicyValues)).min(1),
    resourceValueForms: z.array(z.literal('resource_config')).length(1),
    restartFields: z.array(z.string().min(1)).min(1),
    restartMaxRetriesPolicies: z.array(z.enum(compartmentServiceRestartMaxRetriesPolicyValues)).min(1),
    restartPolicies: z.array(z.enum(compartmentServiceRestartPolicyValues)).min(1),
    runFields: z.array(z.string().min(1)).min(1),
    runForbiddenKinds: z.array(z.enum(compartmentServiceKindValues)),
    serviceConfigFields: z.array(z.string().min(1)).min(1),
    serviceConfigRequiredFields: z.array(z.string().min(1)).min(1),
    serviceConnectionEnvKeyPattern: z.string().min(1),
    serviceConnectionEnvKeyReservedPrefixRule: z.string().min(1),
    serviceConnectionOutputNamePattern: z.string().min(1),
    serviceConnectionShape: z.string().min(1),
    serviceConnectionValidationRules: z.array(z.string().min(1)).min(1),
    serviceKinds: z.array(z.enum(compartmentServiceKindValues)).min(1),
    serviceNamePattern: z.string().min(1),
    serviceObjectOnlyKinds: z.array(z.enum(compartmentServiceKindValues)),
    serviceValueForms: z.array(z.enum(compartmentDescriptorServiceValueFormValues)).min(1),
    servicesMustNotBeEmpty: z.literal(true),
  })
  .strict();

export const compartmentDescriptorSchemaResponseSchema: ContractSchema<CompartmentDescriptorSchemaResponse> = z
  .object({
    defaults: compartmentDescriptorSchemaDefaultsSchema,
    doesNotOwn: z.array(z.string().min(1)).min(1),
    expandedExampleYaml: z.string().min(1),
    fileName: z.string().min(1),
    location: z.string().min(1),
    minimalExampleYaml: z.string().min(1),
    owns: z.array(z.string().min(1)).min(1),
    relatedFiles: z.array(compartmentDescriptorRelatedFileSchema).min(1),
    rules: compartmentDescriptorSchemaRulesSchema,
  })
  .strict();

export function createCompartmentDescriptorSchemaResponse(): CompartmentDescriptorSchemaResponse {
  return compartmentDescriptorSchemaResponseSchema.parse({
    defaults: createCompartmentDescriptorSchemaDefaults(),
    doesNotOwn: [...compartmentDescriptorDoesNotOwn],
    expandedExampleYaml: compartmentDescriptorExpandedExampleYaml,
    fileName: compartmentDescriptorFileName,
    location: compartmentDescriptorLocation,
    minimalExampleYaml: compartmentDescriptorMinimalExampleYaml,
    owns: [...compartmentDescriptorOwns],
    relatedFiles: compartmentDescriptorRelatedFiles.map(
      (relatedFile: CompartmentDescriptorRelatedFile): CompartmentDescriptorRelatedFile => ({ ...relatedFile }),
    ),
    rules: createCompartmentDescriptorSchemaRules(),
  });
}

function createCompartmentDescriptorSchemaDefaults(): CompartmentDescriptorSchemaDefaults {
  return {
    readiness: resolveServiceReadinessConfig(undefined),
    resourceReadiness: null,
    resourceRestart: {
      policy: 'unless-stopped',
    },
    serviceBuild: resolveCompartmentServiceBuildConfig(undefined),
    serviceKind: resolveCompartmentServiceKind(undefined),
    serviceRelease: resolveCompartmentServiceReleaseConfig(undefined),
    serviceRun: resolveCompartmentServiceRunConfig(undefined),
  };
}

function createCompartmentDescriptorSchemaRules(): CompartmentDescriptorSchemaRules {
  const resourceRules: CompartmentDescriptorResourceRules = createCompartmentDescriptorResourceRules();

  return {
    ...resourceRules,
    ...createCompartmentDescriptorStaticRules(),
    buildFields: [...compartmentServiceBuildFieldNames],
    buildStrategies: [...compartmentServiceBuildStrategyValues],
    projectNamePattern: compartmentProjectNamePatternText,
    projectReservedNames: [...compartmentReservedProjectNames],
    readinessFields: [...compartmentServiceReadinessFieldNames],
    readinessTypes: [...compartmentServiceReadinessTypeValues],
    releaseFields: [...compartmentServiceReleaseFieldNames],
    restartFields: [...compartmentServiceRestartFieldNames],
    restartMaxRetriesPolicies: [...compartmentServiceRestartMaxRetriesPolicyValues],
    restartPolicies: [...compartmentServiceRestartPolicyValues],
    runFields: [...compartmentServiceRunFieldNames],
    serviceConfigFields: [...compartmentDescriptorServiceConfigFieldNames],
    serviceConfigRequiredFields: [...compartmentDescriptorRequiredServiceConfigFieldNames],
    ...createCompartmentDescriptorServiceConnectionRules(resourceRules),
    serviceKinds: [...compartmentServiceKindValues],
    serviceNamePattern: compartmentServiceNamePatternText,
    serviceValueForms: [...compartmentDescriptorServiceValueFormValues],
    servicesMustNotBeEmpty: true,
  };
}

function createCompartmentDescriptorStaticRules(): Pick<
  CompartmentDescriptorSchemaRules,
  | 'buildOutputDirectoryAllowedKinds'
  | 'buildOutputDirectoryPathRule'
  | 'buildOutputDirectoryRequiredKinds'
  | 'dockerfileIgnoredKinds'
  | 'buildStrategyForbiddenKinds'
  | 'readinessForbiddenKinds'
  | 'releaseForbiddenKinds'
  | 'runForbiddenKinds'
  | 'serviceObjectOnlyKinds'
> {
  return {
    buildOutputDirectoryAllowedKinds: [staticCompartmentServiceKind],
    buildOutputDirectoryPathRule: staticCompartmentServiceOutputDirectoryRule,
    buildOutputDirectoryRequiredKinds: [staticCompartmentServiceKind],
    dockerfileIgnoredKinds: [staticCompartmentServiceKind],
    buildStrategyForbiddenKinds: [staticCompartmentServiceKind],
    readinessForbiddenKinds: [staticCompartmentServiceKind],
    releaseForbiddenKinds: [staticCompartmentServiceKind],
    runForbiddenKinds: [staticCompartmentServiceKind],
    serviceObjectOnlyKinds: [staticCompartmentServiceKind],
  };
}
