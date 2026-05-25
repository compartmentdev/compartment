import { index, pgTable, text, timestamp, type PgTableExtraConfig } from 'drizzle-orm/pg-core';
import { organizations, principals } from './schema-core';
import type * as OnboardingSchemaTypes from './schema-onboarding.types';

export const onboardingFirstDeploySessions: OnboardingSchemaTypes.OnboardingFirstDeploySessionsTable = pgTable(
  'onboarding_first_deploy_sessions',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references((): typeof organizations.id => organizations.id, { onDelete: 'cascade' }),
    createdByPrincipalId: text('created_by_principal_id')
      .notNull()
      .references((): typeof principals.id => principals.id, { onDelete: 'restrict' }),
    state: text('state').notNull(),
    method: text('method'),
    skippedAt: timestamp('skipped_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: OnboardingSchemaTypes.OnboardingFirstDeploySessionsExtraConfigColumns): PgTableExtraConfig => ({
    organizationCreatedAtIndex: index('onboarding_first_deploy_sessions_org_created_at_idx').on(
      table.organizationId,
      table.createdAt,
    ),
  }),
);
