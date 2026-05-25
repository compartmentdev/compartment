import type {
  CompartmentDescriptorSchemaRules,
  CompartmentResourcePresetSchemaRule,
} from './compartment-descriptor.types';
import {
  compartmentDescriptorResourceConfigFieldNames,
  compartmentDescriptorResourceConfigRequiredFieldSets,
  compartmentResourceOperationFieldNames,
  compartmentResourceOperationRetentionFieldNames,
  compartmentResourceOperationScheduleFieldNames,
  compartmentResourceOutputFieldNames,
  compartmentResourceOutputNamePatternText,
  compartmentResourceReadinessFieldNames,
  compartmentResourceRestartFieldNames,
  readCompartmentResourceOperationScheduleIntervals,
  readCompartmentResourceRestartPolicies,
} from './compartment-resource.contract';
import {
  compartmentResourceGeneratedVariableFieldNames,
  readCompartmentResourceGeneratedVariableEncodings,
  readCompartmentResourceGeneratedVariableGenerators,
} from './compartment-resource-generated-variable.contract';
import {
  compartmentResourcePresetOverrideFieldNames,
  compartmentResourcePresetValues,
} from './compartment-resource-preset.contract';

export type CompartmentDescriptorResourceRules = Pick<
  CompartmentDescriptorSchemaRules,
  | 'resourceConfigFields'
  | 'resourceConfigRequiredFieldSets'
  | 'resourceGeneratedVariableEncodings'
  | 'resourceGeneratedVariableFields'
  | 'resourceGeneratedVariableGenerators'
  | 'resourceOperationFields'
  | 'resourceOperationRetentionFields'
  | 'resourceOperationScheduleFields'
  | 'resourceOperationScheduleIntervals'
  | 'resourceOutputFields'
  | 'resourceOutputNamePattern'
  | 'resourcePresetRules'
  | 'resourcePresets'
  | 'resourceReadinessFields'
  | 'resourceReadinessTypes'
  | 'resourceRestartFields'
  | 'resourceRestartPolicies'
  | 'resourceValueForms'
>;

type CompartmentDescriptorResourceGeneratedVariableRules = Pick<
  CompartmentDescriptorSchemaRules,
  'resourceGeneratedVariableEncodings' | 'resourceGeneratedVariableFields' | 'resourceGeneratedVariableGenerators'
>;

const postgresResourcePresetRule: CompartmentResourcePresetSchemaRule = {
  overrideFields: [...compartmentResourcePresetOverrideFieldNames],
};

export function createCompartmentDescriptorResourceRules(): CompartmentDescriptorResourceRules {
  return {
    resourceConfigFields: [...compartmentDescriptorResourceConfigFieldNames],
    resourceConfigRequiredFieldSets: compartmentDescriptorResourceConfigRequiredFieldSets.map(
      (fieldSet: readonly string[]): string[] => [...fieldSet],
    ),
    ...createCompartmentDescriptorResourceGeneratedVariableRules(),
    resourceOperationFields: [...compartmentResourceOperationFieldNames],
    resourceOperationRetentionFields: [...compartmentResourceOperationRetentionFieldNames],
    resourceOperationScheduleFields: [...compartmentResourceOperationScheduleFieldNames],
    resourceOperationScheduleIntervals: readCompartmentResourceOperationScheduleIntervals(),
    resourceOutputFields: [...compartmentResourceOutputFieldNames],
    resourceOutputNamePattern: compartmentResourceOutputNamePatternText,
    resourcePresetRules: {
      postgres: postgresResourcePresetRule,
    },
    resourcePresets: [...compartmentResourcePresetValues],
    resourceReadinessFields: [...compartmentResourceReadinessFieldNames],
    resourceReadinessTypes: ['tcp'],
    resourceRestartFields: [...compartmentResourceRestartFieldNames],
    resourceRestartPolicies: readCompartmentResourceRestartPolicies(),
    resourceValueForms: ['resource_config'],
  };
}

function createCompartmentDescriptorResourceGeneratedVariableRules(): CompartmentDescriptorResourceGeneratedVariableRules {
  return {
    resourceGeneratedVariableEncodings: readCompartmentResourceGeneratedVariableEncodings(),
    resourceGeneratedVariableFields: [...compartmentResourceGeneratedVariableFieldNames],
    resourceGeneratedVariableGenerators: readCompartmentResourceGeneratedVariableGenerators(),
  };
}
