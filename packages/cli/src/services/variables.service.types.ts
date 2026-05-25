import type { VariableImportEntry, VariableSensitivity } from '@compartment/contracts';

export interface VariableScopeInput {
  cwd: string;
  environmentName?: string | undefined;
  projectName?: string | undefined;
  resourceName?: string | undefined;
  serviceName?: string | undefined;
}

export interface RunVariableCommandInput extends VariableScopeInput {
  allowProduction: boolean;
  childCommand: readonly string[];
}

export interface SetVariableInput extends VariableScopeInput {
  fromResource?: string | undefined;
  keyName: string;
  sensitivity?: VariableSensitivity | undefined;
  value?: string | undefined;
}

export interface ImportVariablesInput extends VariableScopeInput {
  entries: VariableImportEntry[];
  replace?: boolean | undefined;
  sensitivity?: VariableSensitivity | undefined;
}

export interface ShowVariableInput extends VariableScopeInput {
  keyName: string;
}

export interface RemoveVariableInput extends VariableScopeInput {
  keyName: string;
}

interface ResolvedVariableBaseTarget {
  environmentName?: string | undefined;
  projectName: string;
  resourceName?: string | undefined;
  serviceName?: string | undefined;
}

export type ResolvedVariableReadTarget = ResolvedVariableBaseTarget;
export type ResolvedVariableWriteTarget = ResolvedVariableBaseTarget;
