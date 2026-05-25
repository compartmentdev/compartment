import type { VariableImportEntry, VariableSensitivity } from '@compartment/contracts';
import type { VariableScopeInput } from './variables.service.types';

export interface VariableGroupReadInput {
  variableGroupName: string;
}

export interface VariableGroupCaptureInput extends VariableScopeInput {
  effective?: boolean | undefined;
  variableGroupName: string;
}

export interface PutVariableGroupVariableInput extends VariableGroupReadInput {
  keyName: string;
  sensitivity?: VariableSensitivity | undefined;
  value: string;
}

export interface ImportVariableGroupInput extends VariableGroupReadInput {
  entries: VariableImportEntry[];
  replace?: boolean | undefined;
  sensitivity?: VariableSensitivity | undefined;
}

export interface VariableGroupBindingInput extends VariableScopeInput {
  variableGroupName: string;
}
