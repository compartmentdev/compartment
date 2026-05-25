import type { VariableSensitivity } from '@compartment/contracts';
import type { InsertVariableChangeEventInput } from './variables.query.types';

export interface VariableGroupRow {
  archivedAt: Date | null;
  createdAt: Date;
  createdByPrincipalId: string | null;
  description: string | null;
  id: string;
  name: string;
  organizationId: string;
  updatedAt: Date;
}

export interface VariableGroupSummaryRow {
  createdAt: Date;
  description: string | null;
  name: string;
  updatedAt: Date;
  variableCount: number;
}

export interface VariableGroupUsageRow {
  environmentName: string;
  projectName: string;
  resourceName: string | null;
  serviceName: string | null;
}

export interface CreateVariableGroupInput {
  createdByPrincipalId: string;
  description?: string | null | undefined;
  id: string;
  name: string;
  organizationId: string;
  updatedAt: Date;
}

export interface UpsertVariableGroupEntryInput {
  createdByPrincipalId: string;
  encryptionKeyId: string;
  id: string;
  keyName: string;
  sensitivity: VariableSensitivity;
  updatedAt: Date;
  updatedByPrincipalId: string;
  valueCiphertext: string;
  valueFingerprint: string;
  variableGroupId: string;
}

export interface ImportVariableGroupEntriesInput {
  changeEvent: InsertVariableChangeEventInput;
  updatedAt: Date;
  values: UpsertVariableGroupEntryInput[];
  variableGroupId: string;
}

export interface CaptureVariableGroupInput {
  changeEvent: InsertVariableChangeEventInput;
  group: CreateVariableGroupInput;
  values: UpsertVariableGroupEntryInput[];
}

export interface CreateVariableGroupBindingInput {
  createdByPrincipalId: string;
  environmentId: string;
  id: string;
  projectServiceId: string | null;
  targetResourceName: string | null;
  variableGroupId: string;
}

export interface DeleteVariableGroupBindingInput {
  environmentId: string;
  projectServiceId: string | null;
  targetResourceName: string | null;
  variableGroupId: string;
}

export interface PersistedVariableGroupSummaryRow {
  createdAt: Date;
  description: string | null;
  name: string;
  updatedAt: Date;
  variableCount: number;
}
