import { count, eq, sql } from 'drizzle-orm';
import type { ApiDatabaseTransaction } from '../db/client.types';
import { organizations, ssoOidcProviders } from '../db/schema';

interface OrganizationLocalPasswordEnabledRow {
  localPasswordEnabled: boolean;
}

interface SsoOidcProviderCountRow {
  value: number;
}

export async function lockOrganizationLoginMethodMutation(
  transaction: ApiDatabaseTransaction,
  organizationId: string,
): Promise<void> {
  await transaction.execute(
    sql`select ${organizations.id} from ${organizations} where ${organizations.id} = ${organizationId} for update`,
  );
}

export async function readOrganizationLocalPasswordEnabledWithExecutor(
  transaction: ApiDatabaseTransaction,
  organizationId: string,
): Promise<boolean> {
  const rows: OrganizationLocalPasswordEnabledRow[] = await transaction
    .select({ localPasswordEnabled: organizations.localPasswordEnabled })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  return requireOrganizationLocalPasswordEnabled(rows[0]);
}

export async function countSsoOidcProvidersWithExecutor(
  transaction: ApiDatabaseTransaction,
  organizationId: string,
): Promise<number> {
  const rows: SsoOidcProviderCountRow[] = await transaction
    .select({ value: count() })
    .from(ssoOidcProviders)
    .where(eq(ssoOidcProviders.organizationId, organizationId));

  return rows[0]?.value ?? 0;
}

function requireOrganizationLocalPasswordEnabled(row: OrganizationLocalPasswordEnabledRow | undefined): boolean {
  if (row === undefined) {
    throw new Error('Expected organization login-method lock to find an organization row.');
  }

  return row.localPasswordEnabled;
}
