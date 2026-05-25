import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  type PgTableExtraConfig,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { organizations, principals } from './schema-core';
import { environments, projects, projectServices } from './schema-platform';
import {
  buildCreatedAuditColumns,
  buildEnvironmentScopeColumns,
  buildStoredVariablePayloadColumns,
  buildVariableAuditActorColumns,
} from './schema-column-builders';
import type * as VariablesSchemaTypes from './schema-variables.types';

export const organizationVariableSets: VariablesSchemaTypes.OrganizationVariableSetsTable = pgTable(
  'organization_variable_sets',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references((): typeof organizations.id => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    createdByPrincipalId: text('created_by_principal_id').references((): typeof principals.id => principals.id, {
      onDelete: 'set null',
    }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: VariablesSchemaTypes.OrganizationVariableSetsExtraConfigColumns): PgTableExtraConfig => ({
    organizationNameUnique: unique('organization_variable_sets_organization_id_name_unique').on(
      table.organizationId,
      table.name,
    ),
  }),
);

export const organizationVariableSetEntries: VariablesSchemaTypes.OrganizationVariableSetEntriesTable = pgTable(
  'organization_variable_set_entries',
  {
    id: text('id').primaryKey(),
    organizationVariableSetId: text('organization_variable_set_id')
      .notNull()
      .references((): typeof organizationVariableSets.id => organizationVariableSets.id, { onDelete: 'cascade' }),
    ...buildStoredVariablePayloadColumns(),
  },
  (table: VariablesSchemaTypes.OrganizationVariableSetEntriesExtraConfigColumns): PgTableExtraConfig => ({
    variableSetKeyUnique: unique('organization_variable_set_entries_set_id_key_name_unique').on(
      table.organizationVariableSetId,
      table.keyName,
    ),
  }),
);

export const environmentVariableValues: VariablesSchemaTypes.EnvironmentVariableValuesTable = pgTable(
  'environment_variable_values',
  {
    id: text('id').primaryKey(),
    ...buildEnvironmentScopeColumns(),
    ...buildStoredVariablePayloadColumns(),
  },
  (table: VariablesSchemaTypes.EnvironmentVariableValuesExtraConfigColumns): PgTableExtraConfig => ({
    environmentScopedKeyUnique: uniqueIndex('environment_variable_values_env_id_key_name_unique')
      .on(table.environmentId, table.keyName)
      .where(sql`${table.projectServiceId} is null and ${table.targetResourceName} is null`),
    serviceScopedKeyUnique: uniqueIndex('environment_variable_values_env_id_service_id_key_name_unique')
      .on(table.environmentId, table.projectServiceId, table.keyName)
      .where(sql`${table.projectServiceId} is not null and ${table.targetResourceName} is null`),
    resourceScopedKeyUnique: uniqueIndex('environment_variable_values_env_id_resource_name_key_name_unique')
      .on(table.environmentId, table.targetResourceName, table.keyName)
      .where(sql`${table.projectServiceId} is null and ${table.targetResourceName} is not null`),
    targetExclusivityCheck: check(
      'environment_variable_values_target_exclusivity_check',
      sql`${table.projectServiceId} is null or ${table.targetResourceName} is null`,
    ),
  }),
);

export const environmentVariableSetBindings: VariablesSchemaTypes.EnvironmentVariableSetBindingsTable = pgTable(
  'environment_variable_set_bindings',
  {
    id: text('id').primaryKey(),
    ...buildEnvironmentScopeColumns(),
    organizationVariableSetId: text('organization_variable_set_id')
      .notNull()
      .references((): typeof organizationVariableSets.id => organizationVariableSets.id, { onDelete: 'cascade' }),
    ...buildCreatedAuditColumns(),
  },
  (table: VariablesSchemaTypes.EnvironmentVariableSetBindingsExtraConfigColumns): PgTableExtraConfig => ({
    environmentBindingUnique: uniqueIndex('environment_variable_set_bindings_env_id_set_id_unique')
      .on(table.environmentId, table.organizationVariableSetId)
      .where(sql`${table.projectServiceId} is null and ${table.targetResourceName} is null`),
    serviceBindingUnique: uniqueIndex('environment_variable_set_bindings_env_id_service_id_set_id_unique')
      .on(table.environmentId, table.projectServiceId, table.organizationVariableSetId)
      .where(sql`${table.projectServiceId} is not null and ${table.targetResourceName} is null`),
    resourceBindingUnique: uniqueIndex('environment_variable_set_bindings_env_id_resource_name_set_id_unique')
      .on(table.environmentId, table.targetResourceName, table.organizationVariableSetId)
      .where(sql`${table.projectServiceId} is null and ${table.targetResourceName} is not null`),
    targetExclusivityCheck: check(
      'environment_variable_set_bindings_target_exclusivity_check',
      sql`${table.projectServiceId} is null or ${table.targetResourceName} is null`,
    ),
  }),
);

export const environmentResourceOutputVariableBindings: VariablesSchemaTypes.EnvironmentResourceOutputVariableBindingsTable =
  pgTable(
    'environment_resource_output_variable_bindings',
    {
      id: text('id').primaryKey(),
      environmentId: text('environment_id')
        .notNull()
        .references((): typeof environments.id => environments.id, { onDelete: 'cascade' }),
      targetServiceName: text('target_service_name').notNull(),
      keyName: text('key_name').notNull(),
      resourceName: text('resource_name').notNull(),
      outputName: text('output_name').notNull(),
      source: text('source').default('cli').notNull(),
      ...buildCreatedAuditColumns(),
      updatedByPrincipalId: text('updated_by_principal_id').references((): typeof principals.id => principals.id, {
        onDelete: 'set null',
      }),
      updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    },
    (table: VariablesSchemaTypes.EnvironmentResourceOutputVariableBindingsExtraConfigColumns): PgTableExtraConfig => ({
      serviceKeyUnique: unique('environment_resource_output_bindings_env_service_key_unique').on(
        table.environmentId,
        table.targetServiceName,
        table.keyName,
      ),
      sourceCheck: check(
        'environment_resource_output_bindings_source_check',
        sql`${table.source} in ('cli', 'descriptor')`,
      ),
    }),
  );

export const variableChangeEvents: VariablesSchemaTypes.VariableChangeEventsTable = pgTable('variable_change_events', {
  id: text('id').primaryKey(),
  ...buildVariableAuditActorColumns(),
  targetType: text('target_type', {
    enum: ['binding', 'environment', 'resource', 'service', 'variable_set'],
  }).notNull(),
  targetId: text('target_id').notNull(),
  operation: text('operation', { enum: ['bind', 'capture', 'import', 'remove', 'replace', 'set', 'unbind'] }).notNull(),
  keyNamesJson: text('key_names_json').notNull(),
  sensitivityJson: text('sensitivity_json'),
  fingerprintsJson: text('fingerprints_json'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const variableAccessEvents: VariablesSchemaTypes.VariableAccessEventsTable = pgTable(
  'variable_access_events',
  {
    id: text('id').primaryKey(),
    ...buildVariableAuditActorColumns(),
    projectId: text('project_id').references((): typeof projects.id => projects.id, { onDelete: 'set null' }),
    environmentId: text('environment_id').references((): typeof environments.id => environments.id, {
      onDelete: 'set null',
    }),
    projectServiceId: text('project_service_id').references((): typeof projectServices.id => projectServices.id, {
      onDelete: 'set null',
    }),
    targetResourceName: text('target_resource_name'),
    targetProjectName: text('target_project_name').notNull(),
    targetEnvironmentName: text('target_environment_name').notNull(),
    targetServiceName: text('target_service_name'),
    operation: text('operation', { enum: ['local_run', 'resource_output_reveal'] }).notNull(),
    production: boolean('production').notNull(),
    commandName: text('command_name'),
    keyNamesJson: text('key_names_json').notNull(),
    sensitivityJson: text('sensitivity_json').notNull(),
    fingerprintsJson: text('fingerprints_json').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: VariablesSchemaTypes.VariableAccessEventsExtraConfigColumns): PgTableExtraConfig => ({
    actorCreatedAtIndex: index('variable_access_events_actor_created_at_idx').on(
      table.actorPrincipalId,
      table.createdAt,
    ),
    organizationCreatedAtIndex: index('variable_access_events_organization_created_at_idx').on(
      table.organizationId,
      table.createdAt,
    ),
    productionCreatedAtIndex: index('variable_access_events_production_created_at_idx').on(
      table.organizationId,
      table.production,
      table.createdAt,
    ),
    operationCheck: check(
      'variable_access_events_operation_check',
      sql`${table.operation} in ('local_run', 'resource_output_reveal')`,
    ),
    targetCreatedAtIndex: index('variable_access_events_target_created_at_idx').on(
      table.organizationId,
      table.targetProjectName,
      table.targetEnvironmentName,
      table.createdAt,
    ),
  }),
);
