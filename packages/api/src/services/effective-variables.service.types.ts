import type { VariableScopeType, VariableSensitivity, VariableSourceType } from '@compartment/contracts';
import type {
  EnvironmentVariableSetBindingRow,
  EnvironmentVariableValueRow,
  EnvironmentResourceOutputVariableBindingRow,
  OrganizationVariableSetEntryRow,
  OrganizationVariableSetNameRow,
} from '../queries/variables.query.types';

export interface LoadEffectiveVariablesInput {
  environmentId: string;
  environmentName: string;
  organizationId: string;
  projectName: string;
  targetResourceName: string | null;
  targetServiceId: string | null;
  targetServiceName: string | null;
  targetType: 'environment' | 'resource' | 'service';
}

export interface LoadEffectiveVariablesForBuildEnvOptions {
  ignoredDescriptorResourceOutputBindingKeyNames: readonly string[];
}

export interface EffectiveVariableQueryRows {
  variableSetBindings: EnvironmentVariableSetBindingRow[];
  resourceOutputVariableBindings: EnvironmentResourceOutputVariableBindingRow[];
  variableSetEntries: OrganizationVariableSetEntryRow[];
  variableSetNames: OrganizationVariableSetNameRow[];
  variableValues: EnvironmentVariableValueRow[];
}

export interface ListedVariable {
  keyName: string;
  scopeResourceName: string | null;
  scopeServiceName: string | null;
  scopeType: VariableScopeType;
  sensitivity: VariableSensitivity;
  sourceResourceOutput: string | null;
  sourceType: VariableSourceType;
  sourceVariableSetName: string | null;
}

export interface EffectiveVariable extends ListedVariable {
  value: string;
}

export interface StoredEffectiveVariable extends ListedVariable {
  encryptionKeyId: string | null;
  valueCiphertext: string | null;
  valueFingerprint: string;
  valuePlaintext: string | null;
}
