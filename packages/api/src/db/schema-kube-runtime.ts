import { index, integer, pgTable, text, timestamp, type PgTableExtraConfig } from 'drizzle-orm/pg-core';
import { deployments } from './schema-deploy';
import type * as KubeRuntimeSchemaTypes from './schema-kube-runtime.types';

export const deploymentKubeReferences: KubeRuntimeSchemaTypes.DeploymentKubeReferencesTable = pgTable(
  'deployment_kube_references',
  {
    id: text('id').primaryKey(),
    deploymentId: text('deployment_id')
      .notNull()
      .references((): typeof deployments.id => deployments.id, { onDelete: 'cascade' })
      .unique(),
    namespace: text('namespace').notNull(),
    deploymentName: text('deployment_name').notNull(),
    serviceName: text('service_name').notNull(),
    networkPolicyNamesJson: text('network_policy_names_json').notNull(),
    state: text('state', { enum: ['desired', 'pending', 'active'] }).notNull(),
    revision: integer('revision').default(0).notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }),
    transitionedAt: timestamp('transitioned_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: KubeRuntimeSchemaTypes.DeploymentKubeReferencesExtraConfigColumns): PgTableExtraConfig => ({
    stateUpdatedAtIndex: index('deployment_kube_references_state_updated_at_idx').on(table.state, table.updatedAt),
  }),
);
