import type { VariableImportEntry, VariableSensitivity } from '@compartment/contracts';
import type { EnvironmentRow, ProjectServiceRow } from '../queries/deployments.query.types';
import type { OrganizationRow } from '../queries/organizations.query.types';
import type { ProjectRow } from '../queries/projects.query.types';
import type { EffectiveVariable, ListedVariable } from './effective-variables.service.types';

export interface VariableTargetInput {
  environmentName?: string | undefined;
  organizationSlug: string;
  principalId: string;
  projectName: string;
  resourceName?: string | undefined;
  serviceName?: string | undefined;
}

export interface SetVariableInput extends VariableTargetInput {
  fromResource?: string | undefined;
  keyName: string;
  sensitivity?: VariableSensitivity | undefined;
  value?: string | undefined;
}

export interface ImportVariablesInput extends VariableTargetInput {
  entries: VariableImportEntry[];
  replace?: boolean | undefined;
  sensitivity?: VariableSensitivity | undefined;
}

export interface RemoveVariableInput extends VariableTargetInput {
  keyName: string;
}

export interface ShowVariableInput extends VariableTargetInput {
  keyName: string;
}

export interface VariableLocalRunInput {
  commandName?: string | null | undefined;
  environmentName: string;
  organizationSlug: string;
  principalId: string;
  projectName: string;
  resourceName: string | null;
  serviceName: string | null;
}

export interface VariableTargetContext {
  environment: EnvironmentRow;
  organization: OrganizationRow;
  project: ProjectRow;
  resourceName: string | null;
  service: ProjectServiceRow | null;
  serviceName: string | null;
}

export interface VariableListResult {
  environment: EnvironmentRow;
  project: ProjectRow;
  resourceName: string | null;
  serviceName: string | null;
  variables: ListedVariable[];
}

export interface VariableResult {
  environment: EnvironmentRow;
  project: ProjectRow;
  resourceName: string | null;
  serviceName: string | null;
  variable: VariableDetailResult;
}

export interface VariableLocalRunResult {
  accessEventId: string;
  environment: EnvironmentRow;
  project: ProjectRow;
  resourceName: string | null;
  serviceName: string | null;
  variables: VariableLocalRunValue[];
}

export interface VariableLocalRunValue extends EffectiveVariable {
  valueFingerprint: string;
}

export interface ImportVariablesResult {
  environment: EnvironmentRow;
  importedKeyNames: string[];
  project: ProjectRow;
  resourceName: string | null;
  serviceName: string | null;
}

export interface VariableDetailResult extends ListedVariable {
  value: string | null;
  valueHidden: boolean;
}
