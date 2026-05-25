import type { CompartmentDescriptorResourceRules } from './compartment-descriptor-resource-rules.contract';
import type { CompartmentDescriptorSchemaRules } from './compartment-descriptor.types';
import {
  compartmentServiceConnectionShapeRule,
  compartmentServiceConnectionValidationRules,
} from './compartment-service-connections.contract';
import { variableKeyNamePatternText, variableKeyNameReservedPrefixRuleText } from './variable-key.contract';

export function createCompartmentDescriptorServiceConnectionRules(
  resourceRules: CompartmentDescriptorResourceRules,
): Pick<
  CompartmentDescriptorSchemaRules,
  | 'serviceConnectionEnvKeyPattern'
  | 'serviceConnectionEnvKeyReservedPrefixRule'
  | 'serviceConnectionOutputNamePattern'
  | 'serviceConnectionShape'
  | 'serviceConnectionValidationRules'
> {
  return {
    serviceConnectionEnvKeyPattern: variableKeyNamePatternText,
    serviceConnectionEnvKeyReservedPrefixRule: variableKeyNameReservedPrefixRuleText,
    serviceConnectionOutputNamePattern: resourceRules.resourceOutputNamePattern,
    serviceConnectionShape: compartmentServiceConnectionShapeRule,
    serviceConnectionValidationRules: [...compartmentServiceConnectionValidationRules],
  };
}
