import { text, timestamp } from 'drizzle-orm/pg-core';
import { organizations, principals } from './schema-core';
import { environments, projectServices } from './schema-platform';
import type {
  CreatedAuditColumnBuilders,
  EnvironmentScopeColumnBuilders,
  StoredVariablePayloadColumnBuilders,
  VariableAuditActorColumnBuilders,
} from './schema-variables.types';
import type { DefaultTimestampBuilder, OptionalTextBuilder, RequiredTextBuilder } from './schema.shared.types';

export function buildEnvironmentScopeColumns(): EnvironmentScopeColumnBuilders {
  return {
    environmentId: buildEnvironmentIdColumn(),
    projectServiceId: buildProjectServiceIdColumn(),
    targetResourceName: text('target_resource_name'),
  };
}

export function buildStoredVariablePayloadColumns(): StoredVariablePayloadColumnBuilders {
  return {
    keyName: text('key_name').notNull(),
    sensitivity: text('sensitivity', { enum: ['plain', 'sensitive'] }).notNull(),
    valueCiphertext: text('value_ciphertext').notNull(),
    valueFingerprint: text('value_fingerprint').notNull(),
    encryptionKeyId: text('encryption_key_id').notNull(),
    createdByPrincipalId: buildCreatedByPrincipalIdColumn(),
    updatedByPrincipalId: buildUpdatedByPrincipalIdColumn(),
    createdAt: buildCreatedAtColumn(),
    updatedAt: buildUpdatedAtColumn(),
  };
}

export function buildCreatedAuditColumns(): CreatedAuditColumnBuilders {
  return {
    createdByPrincipalId: buildCreatedByPrincipalIdColumn(),
    createdAt: buildCreatedAtColumn(),
  };
}

export function buildVariableAuditActorColumns(): VariableAuditActorColumnBuilders {
  return {
    actorPrincipalId: text('actor_principal_id')
      .notNull()
      .references((): typeof principals.id => principals.id, { onDelete: 'restrict' }),
    organizationId: text('organization_id')
      .notNull()
      .references((): typeof organizations.id => organizations.id, { onDelete: 'cascade' }),
  };
}

function buildCreatedAtColumn(): DefaultTimestampBuilder<'created_at'> {
  return timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
}

function buildUpdatedAtColumn(): DefaultTimestampBuilder<'updated_at'> {
  return timestamp('updated_at', { withTimezone: true }).defaultNow().notNull();
}

function buildEnvironmentIdColumn(): RequiredTextBuilder<'environment_id'> {
  return text('environment_id')
    .notNull()
    .references((): typeof environments.id => environments.id, { onDelete: 'cascade' });
}

function buildProjectServiceIdColumn(): OptionalTextBuilder<'project_service_id'> {
  return text('project_service_id').references((): typeof projectServices.id => projectServices.id, {
    onDelete: 'cascade',
  });
}

function buildCreatedByPrincipalIdColumn(): OptionalTextBuilder<'created_by_principal_id'> {
  return text('created_by_principal_id').references((): typeof principals.id => principals.id, {
    onDelete: 'set null',
  });
}

function buildUpdatedByPrincipalIdColumn(): OptionalTextBuilder<'updated_by_principal_id'> {
  return text('updated_by_principal_id').references((): typeof principals.id => principals.id, {
    onDelete: 'set null',
  });
}
