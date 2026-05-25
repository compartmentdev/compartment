import { index, pgTable, text, timestamp, type PgTableExtraConfig } from 'drizzle-orm/pg-core';
import type * as BrowserAuthSchemaTypes from './schema-browser-auth.types';

export const browserAuthTokenFlows: BrowserAuthSchemaTypes.BrowserAuthTokenFlowsTable = pgTable(
  'browser_auth_token_flows',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: ['activation', 'password_reset'] }).notNull(),
    tokenCiphertext: text('token_ciphertext').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (table: BrowserAuthSchemaTypes.BrowserAuthTokenFlowsExtraConfigColumns): PgTableExtraConfig => ({
    staleIndex: index('browser_auth_token_flows_stale_idx').on(table.consumedAt, table.expiresAt, table.id),
  }),
);
