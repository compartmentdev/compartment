import type { VariableImportEntry, VariableSensitivity } from '@compartment/contracts';
import type { EnvironmentRow, ProjectServiceRow } from '../queries/deployments.query.types';
import type { OrganizationVariableSetEntryRow } from '../queries/variables.query.types';
import type { ProjectRow } from '../queries/projects.query.types';

interface VariableGroupOrganizationInput {
  organizationId: string;
  principalId: string;
}

interface VariableGroupTargetBaseInput extends VariableGroupOrganizationInput {
  environmentName?: string | undefined;
  organizationSlug: string;
  projectName: string;
  resourceName?: string | undefined;
  serviceName?: string | undefined;
  variableGroupName: string;
}

export interface CreateVariableGroupInput extends VariableGroupOrganizationInput {
  description?: string | undefined;
  variableGroupName: string;
}

export interface PutVariableGroupVariableInput extends VariableGroupOrganizationInput {
  keyName: string;
  sensitivity?: VariableSensitivity | undefined;
  value: string;
  variableGroupName: string;
}

export interface ImportVariableGroupInput extends VariableGroupOrganizationInput {
  entries: VariableImportEntry[];
  replace?: boolean | undefined;
  sensitivity?: VariableSensitivity | undefined;
  variableGroupName: string;
}

export interface CaptureVariableGroupInput extends VariableGroupTargetBaseInput {
  effective?: boolean | undefined;
}

export interface VariableGroupReadInput extends VariableGroupOrganizationInput {
  variableGroupName: string;
}

export type VariableGroupBindingInput = VariableGroupTargetBaseInput;

export interface VariableGroupVariableResult {
  keyName: string;
  sensitivity: VariableSensitivity;
}

export interface VariableGroupSummaryResult {
  createdAt: Date;
  description: string | null;
  name: string;
  updatedAt: Date;
  variableCount: number;
}

export interface VariableGroupDetailResult extends VariableGroupSummaryResult {
  variables: VariableGroupVariableResult[];
}

export interface VariableGroupResponseResult {
  variableGroup: VariableGroupDetailResult;
}

export interface VariableGroupListResult {
  variableGroups: VariableGroupSummaryResult[];
}

export interface ImportVariableGroupResult {
  importedKeyNames: string[];
  variableGroup: VariableGroupDetailResult;
}

export interface CaptureVariableGroupResult {
  capturedKeyNames: string[];
  environment: EnvironmentRow;
  project: ProjectRow;
  resourceName: string | null;
  serviceName: string | null;
  variableGroup: VariableGroupDetailResult;
}

export interface VariableGroupUsageResult {
  environmentName: string;
  projectName: string;
  resourceName: string | null;
  serviceName: string | null;
}

export interface VariableGroupUsagesResult {
  usages: VariableGroupUsageResult[];
  variableGroup: VariableGroupSummaryResult;
}

export interface VariableGroupBindingResult {
  environment: EnvironmentRow;
  project: ProjectRow;
  resourceName: string | null;
  serviceName: string | null;
  variableGroupName: string;
}

export interface CapturedVariableValue {
  keyName: string;
  sensitivity: VariableSensitivity;
  value: string;
}

export interface LoadedVariableGroup {
  createdAt: Date;
  description: string | null;
  id: string;
  name: string;
  organizationId: string;
  updatedAt: Date;
  variables: OrganizationVariableSetEntryRow[];
}

export interface VariableGroupBindingTargetContext {
  environment: EnvironmentRow;
  project: ProjectRow;
  resourceName: string | null;
  service: ProjectServiceRow | null;
  serviceName: string | null;
}
