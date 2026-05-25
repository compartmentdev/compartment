import { noAnonymousInterfaceImplementationRule } from './rules/no-anonymous-interface-implementation.mjs';
import { noContractDtoInApiServicesRule } from './rules/no-contract-dto-in-api-services.mjs';
import { noInlineMultilineTextJoinRule } from './rules/no-inline-multiline-text-join.mjs';
import { noInterfacesBelowFunctionsRule } from './rules/no-interfaces-below-functions.mjs';
import { noReflectionTypeSyntaxRule } from './rules/no-reflection-type-syntax.mjs';
import { noSinglePropertyDependencyRule } from './rules/no-single-property-dependency.mjs';
import { noTrivialPassThroughWrapperRule } from './rules/no-trivial-pass-through-wrapper.mjs';
import { packageFilePlacementConventionRule } from './rules/package-file-placement-convention.mjs';
import { stepDownFunctionOrderRule } from './rules/step-down-function-order.mjs';

const compartmentRules = {
  'no-anonymous-interface-implementation': noAnonymousInterfaceImplementationRule,
  'no-contract-dto-in-api-services': noContractDtoInApiServicesRule,
  'no-interfaces-below-functions': noInterfacesBelowFunctionsRule,
  'no-inline-multiline-text-join': noInlineMultilineTextJoinRule,
  'no-reflection-type-syntax': noReflectionTypeSyntaxRule,
  'no-single-property-dependency': noSinglePropertyDependencyRule,
  'no-trivial-pass-through-wrapper': noTrivialPassThroughWrapperRule,
  'package-file-placement-convention': packageFilePlacementConventionRule,
  'step-down-function-order': stepDownFunctionOrderRule,
};

const compartmentPlugin = {
  meta: {
    name: '@compartment/eslint-plugin',
  },
  rules: compartmentRules,
};

export default compartmentPlugin;
