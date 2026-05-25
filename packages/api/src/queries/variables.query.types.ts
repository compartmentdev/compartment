import type { SelectedFields } from 'drizzle-orm/pg-core/query-builders/select.types';
import type { VariableSensitivity } from '@compartment/contracts';
import type {
  environmentVariableValues,
  environmentVariableSetBindings,
  environmentResourceOutputVariableBindings,
  organizationVariableSetEntries,
  organizationVariableSets,
  projectServices,
  variableAccessEvents,
} from '../db/schema';

export type PersistedOrganizationVariableSetEntryRow = typeof organizationVariableSetEntries.$inferSelect;
export type PersistedEnvironmentVariableValueRow = typeof environmentVariableValues.$inferSelect;
export type PersistedEnvironmentResourceOutputVariableBindingRow =
  typeof environmentResourceOutputVariableBindings.$inferSelect;
export type PersistedOrganizationVariableSetRow = typeof organizationVariableSets.$inferSelect;
export type PersistedProjectServiceRow = typeof projectServices.$inferSelect;
export type VariableAccessEventRow = typeof variableAccessEvents.$inferSelect;

export interface OrganizationVariableSetEntryRow {
  createdAt: Date;
  createdByPrincipalId: string | null;
  encryptionKeyId: string;
  id: string;
  keyName: string;
  organizationVariableSetId: string;
  sensitivity: VariableSensitivity;
  updatedAt: Date;
  updatedByPrincipalId: string | null;
  valueCiphertext: string;
  valueFingerprint: string;
}

export interface EnvironmentVariableValueRow {
  createdAt: Date;
  createdByPrincipalId: string | null;
  encryptionKeyId: string;
  environmentId: string;
  id: string;
  keyName: string;
  projectServiceId: string | null;
  targetResourceName: string | null;
  sensitivity: VariableSensitivity;
  updatedAt: Date;
  updatedByPrincipalId: string | null;
  valueCiphertext: string;
  valueFingerprint: string;
}

export type EnvironmentResourceOutputVariableBindingSource = 'cli' | 'descriptor';

export interface EnvironmentResourceOutputVariableBindingRow {
  createdAt: Date;
  createdByPrincipalId: string | null;
  environmentId: string;
  id: string;
  keyName: string;
  outputName: string;
  resourceName: string;
  source: EnvironmentResourceOutputVariableBindingSource;
  targetServiceName: string;
  updatedAt: Date;
  updatedByPrincipalId: string | null;
}

export interface EnvironmentVariableSetBindingRow {
  createdAt: Date;
  createdByPrincipalId: string | null;
  environmentId: string;
  id: string;
  organizationVariableSetId: string;
  projectServiceId: string | null;
  targetResourceName: string | null;
}

export interface OrganizationVariableSetNameRow {
  id: string;
  name: string;
}

export interface OrganizationVariableSetEntrySelection extends SelectedFields {
  createdAt: typeof organizationVariableSetEntries.createdAt;
  createdByPrincipalId: typeof organizationVariableSetEntries.createdByPrincipalId;
  encryptionKeyId: typeof organizationVariableSetEntries.encryptionKeyId;
  id: typeof organizationVariableSetEntries.id;
  keyName: typeof organizationVariableSetEntries.keyName;
  organizationVariableSetId: typeof organizationVariableSetEntries.organizationVariableSetId;
  sensitivity: typeof organizationVariableSetEntries.sensitivity;
  updatedAt: typeof organizationVariableSetEntries.updatedAt;
  updatedByPrincipalId: typeof organizationVariableSetEntries.updatedByPrincipalId;
  valueCiphertext: typeof organizationVariableSetEntries.valueCiphertext;
  valueFingerprint: typeof organizationVariableSetEntries.valueFingerprint;
}

export interface EnvironmentVariableSetBindingSelection extends SelectedFields {
  createdAt: typeof environmentVariableSetBindings.createdAt;
  createdByPrincipalId: typeof environmentVariableSetBindings.createdByPrincipalId;
  environmentId: typeof environmentVariableSetBindings.environmentId;
  id: typeof environmentVariableSetBindings.id;
  organizationVariableSetId: typeof environmentVariableSetBindings.organizationVariableSetId;
  projectServiceId: typeof environmentVariableSetBindings.projectServiceId;
  targetResourceName: typeof environmentVariableSetBindings.targetResourceName;
}

export interface ProjectServiceNameRow {
  id: string;
  name: string;
}

export interface UpsertEnvironmentVariableValueInput {
  createdByPrincipalId: string;
  environmentId: string;
  id: string;
  keyName: string;
  projectServiceId: string | null;
  targetResourceName: string | null;
  sensitivity: VariableSensitivity;
  updatedAt: Date;
  updatedByPrincipalId: string;
  valueCiphertext: string;
  valueFingerprint: string;
  encryptionKeyId: string;
}

export interface DeleteEnvironmentVariableValueInput {
  environmentId: string;
  keyName: string;
  projectServiceId: string | null;
  targetResourceName: string | null;
}

export interface DeleteEnvironmentResourceOutputVariableBindingInput {
  environmentId: string;
  keyName: string;
  targetServiceName: string;
}

export interface DeleteEnvironmentResourceOutputVariableBindingBySourceInput extends DeleteEnvironmentResourceOutputVariableBindingInput {
  source: EnvironmentResourceOutputVariableBindingSource;
}

export interface ImportEnvironmentVariableValuesInput {
  changeEvent: InsertVariableChangeEventInput;
  values: UpsertEnvironmentVariableValueInput[];
}

export interface UpsertEnvironmentResourceOutputVariableBindingInput {
  createdByPrincipalId: string;
  environmentId: string;
  id: string;
  keyName: string;
  outputName: string;
  resourceName: string;
  source: EnvironmentResourceOutputVariableBindingSource;
  targetServiceName: string;
  updatedAt: Date;
  updatedByPrincipalId: string;
}

export interface InsertVariableChangeEventInput {
  actorPrincipalId: string;
  fingerprintsJson?: string | null | undefined;
  keyNamesJson: string;
  operation: 'bind' | 'capture' | 'import' | 'remove' | 'replace' | 'set' | 'unbind';
  organizationId: string;
  sensitivityJson?: string | null | undefined;
  targetId: string;
  targetType: 'binding' | 'environment' | 'resource' | 'service' | 'variable_set';
}

export interface InsertVariableAccessEventInput {
  actorPrincipalId: string;
  commandName: string | null;
  environmentId: string | null;
  fingerprintsJson: string;
  id: string;
  keyNamesJson: string;
  operation: 'local_run' | 'resource_output_reveal';
  organizationId: string;
  production: boolean;
  projectId: string | null;
  projectServiceId: string | null;
  targetResourceName: string | null;
  sensitivityJson: string;
  targetEnvironmentName: string;
  targetProjectName: string;
  targetServiceName: string | null;
}
