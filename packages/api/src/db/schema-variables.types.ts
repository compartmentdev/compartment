import type {
  DefaultTimestampBuilder,
  DefaultTextBuilder,
  OptionalTextBuilder,
  OptionalTimestampBuilder,
  PgExtraConfigColumnsOf,
  PgTableOf,
  PrimaryTextBuilder,
  RequiredBooleanBuilder,
  RequiredEnumTextBuilder,
  RequiredTextBuilder,
} from './schema.shared.types';

interface OrganizationVariableSetsColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  organizationId: RequiredTextBuilder<'organization_id'>;
  name: RequiredTextBuilder<'name'>;
  description: OptionalTextBuilder<'description'>;
  createdByPrincipalId: OptionalTextBuilder<'created_by_principal_id'>;
  archivedAt: OptionalTimestampBuilder<'archived_at'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

export interface StoredVariablePayloadColumnBuilders {
  keyName: RequiredTextBuilder<'key_name'>;
  sensitivity: VariableSensitivityColumnBuilder;
  valueCiphertext: RequiredTextBuilder<'value_ciphertext'>;
  valueFingerprint: RequiredTextBuilder<'value_fingerprint'>;
  encryptionKeyId: RequiredTextBuilder<'encryption_key_id'>;
  createdByPrincipalId: OptionalTextBuilder<'created_by_principal_id'>;
  updatedByPrincipalId: OptionalTextBuilder<'updated_by_principal_id'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

export type VariableSensitivityColumnBuilder = RequiredEnumTextBuilder<'sensitivity', ['plain', 'sensitive']>;

export interface EnvironmentScopeColumnBuilders {
  environmentId: RequiredTextBuilder<'environment_id'>;
  projectServiceId: OptionalTextBuilder<'project_service_id'>;
  targetResourceName: OptionalTextBuilder<'target_resource_name'>;
}

export interface CreatedAuditColumnBuilders {
  createdByPrincipalId: OptionalTextBuilder<'created_by_principal_id'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
}

export interface VariableAuditActorColumnBuilders {
  actorPrincipalId: RequiredTextBuilder<'actor_principal_id'>;
  organizationId: RequiredTextBuilder<'organization_id'>;
}

interface OrganizationVariableSetEntriesColumnBuilders extends StoredVariablePayloadColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  organizationVariableSetId: RequiredTextBuilder<'organization_variable_set_id'>;
}

interface EnvironmentVariableValuesColumnBuilders
  extends EnvironmentScopeColumnBuilders, StoredVariablePayloadColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
}

interface EnvironmentVariableSetBindingsColumnBuilders
  extends EnvironmentScopeColumnBuilders, CreatedAuditColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  organizationVariableSetId: RequiredTextBuilder<'organization_variable_set_id'>;
}

interface EnvironmentResourceOutputVariableBindingsColumnBuilders extends CreatedAuditColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  environmentId: RequiredTextBuilder<'environment_id'>;
  targetServiceName: RequiredTextBuilder<'target_service_name'>;
  keyName: RequiredTextBuilder<'key_name'>;
  resourceName: RequiredTextBuilder<'resource_name'>;
  outputName: RequiredTextBuilder<'output_name'>;
  source: DefaultTextBuilder<'source'>;
  updatedByPrincipalId: OptionalTextBuilder<'updated_by_principal_id'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

interface VariableChangeEventsColumnBuilders extends VariableAuditActorColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  targetType: RequiredTextBuilder<'target_type'>;
  targetId: RequiredTextBuilder<'target_id'>;
  operation: RequiredTextBuilder<'operation'>;
  keyNamesJson: RequiredTextBuilder<'key_names_json'>;
  sensitivityJson: OptionalTextBuilder<'sensitivity_json'>;
  fingerprintsJson: OptionalTextBuilder<'fingerprints_json'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
}

interface VariableAccessEventsColumnBuilders extends VariableAuditActorColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  projectId: OptionalTextBuilder<'project_id'>;
  environmentId: OptionalTextBuilder<'environment_id'>;
  projectServiceId: OptionalTextBuilder<'project_service_id'>;
  targetResourceName: OptionalTextBuilder<'target_resource_name'>;
  targetProjectName: RequiredTextBuilder<'target_project_name'>;
  targetEnvironmentName: RequiredTextBuilder<'target_environment_name'>;
  targetServiceName: OptionalTextBuilder<'target_service_name'>;
  operation: RequiredEnumTextBuilder<'operation', ['local_run', 'resource_output_reveal']>;
  production: RequiredBooleanBuilder<'production'>;
  commandName: OptionalTextBuilder<'command_name'>;
  keyNamesJson: RequiredTextBuilder<'key_names_json'>;
  sensitivityJson: RequiredTextBuilder<'sensitivity_json'>;
  fingerprintsJson: RequiredTextBuilder<'fingerprints_json'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
}

export type OrganizationVariableSetsTable = PgTableOf<
  'organization_variable_sets',
  OrganizationVariableSetsColumnBuilders
>;
export type OrganizationVariableSetsExtraConfigColumns = PgExtraConfigColumnsOf<
  'organization_variable_sets',
  OrganizationVariableSetsColumnBuilders
>;
export type OrganizationVariableSetEntriesTable = PgTableOf<
  'organization_variable_set_entries',
  OrganizationVariableSetEntriesColumnBuilders
>;
export type OrganizationVariableSetEntriesExtraConfigColumns = PgExtraConfigColumnsOf<
  'organization_variable_set_entries',
  OrganizationVariableSetEntriesColumnBuilders
>;
export type EnvironmentVariableValuesTable = PgTableOf<
  'environment_variable_values',
  EnvironmentVariableValuesColumnBuilders
>;
export type EnvironmentVariableValuesExtraConfigColumns = PgExtraConfigColumnsOf<
  'environment_variable_values',
  EnvironmentVariableValuesColumnBuilders
>;
export type EnvironmentVariableSetBindingsTable = PgTableOf<
  'environment_variable_set_bindings',
  EnvironmentVariableSetBindingsColumnBuilders
>;
export type EnvironmentVariableSetBindingsExtraConfigColumns = PgExtraConfigColumnsOf<
  'environment_variable_set_bindings',
  EnvironmentVariableSetBindingsColumnBuilders
>;
export type EnvironmentResourceOutputVariableBindingsTable = PgTableOf<
  'environment_resource_output_variable_bindings',
  EnvironmentResourceOutputVariableBindingsColumnBuilders
>;
export type EnvironmentResourceOutputVariableBindingsExtraConfigColumns = PgExtraConfigColumnsOf<
  'environment_resource_output_variable_bindings',
  EnvironmentResourceOutputVariableBindingsColumnBuilders
>;
export type VariableChangeEventsTable = PgTableOf<'variable_change_events', VariableChangeEventsColumnBuilders>;
export type VariableAccessEventsTable = PgTableOf<'variable_access_events', VariableAccessEventsColumnBuilders>;
export type VariableAccessEventsExtraConfigColumns = PgExtraConfigColumnsOf<
  'variable_access_events',
  VariableAccessEventsColumnBuilders
>;
