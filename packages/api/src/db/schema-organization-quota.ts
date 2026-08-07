import { index, integer, pgTable, text, timestamp, type PgTableExtraConfig } from 'drizzle-orm/pg-core';
import { organizations } from './schema-core';
import type {
  OrganizationQuotaReconciliationExtraConfigColumns,
  OrganizationQuotaReconciliationTable,
} from './schema-kube-runtime.types';

export const organizationQuotaReconciliation: OrganizationQuotaReconciliationTable = pgTable(
  'organization_quota_reconciliation',
  {
    organizationId: text('organization_id')
      .primaryKey()
      .references((): typeof organizations.id => organizations.id, { onDelete: 'cascade' }),
    state: text('state', { enum: ['pending', 'running', 'succeeded', 'failed'] })
      .default('pending')
      .notNull(),
    leaseId: text('lease_id'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    failureMessage: text('failure_message'),
    attempts: integer('attempts').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: OrganizationQuotaReconciliationExtraConfigColumns): PgTableExtraConfig => ({
    stateLeaseIndex: index('organization_quota_reconciliation_state_lease_idx').on(table.state, table.leaseExpiresAt),
  }),
);
