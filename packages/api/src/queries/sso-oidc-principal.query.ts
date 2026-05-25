import { and, eq } from 'drizzle-orm';
import type { SelectedFields } from 'drizzle-orm/pg-core/query-builders/select.types';
import type { Database } from '../db/client';
import { organizationMemberships, principals } from '../db/schema';
import { buildActiveOrganizationMembershipFilter } from './organization-users.query.helpers';
import { buildPrincipalEmailLookup } from './principal-email.query.helpers';
import type { SsoOidcPrincipalRow } from './sso-oidc.query.types';

interface SsoOidcPrincipalSelection extends SelectedFields {
  principalEmail: typeof principals.email;
  principalId: typeof principals.id;
  principalType: typeof principals.type;
}

export async function findOrganizationSsoPrincipalByEmailWithExecutor(
  executor: SsoOidcPrincipalExecutor,
  organizationId: string,
  email: string,
): Promise<SsoOidcPrincipalRow | undefined> {
  const rows: SsoOidcPrincipalRow[] = await executor
    .select(buildSsoPrincipalSelection())
    .from(organizationMemberships)
    .innerJoin(principals, eq(principals.id, organizationMemberships.principalId))
    .where(and(buildActiveOrganizationMembershipFilter(organizationId), buildPrincipalEmailLookup(email)))
    .limit(1);

  return rows[0];
}

export async function findOrganizationSsoPrincipalByIdWithExecutor(
  executor: SsoOidcPrincipalExecutor,
  organizationId: string,
  principalId: string,
): Promise<SsoOidcPrincipalRow | undefined> {
  const rows: SsoOidcPrincipalRow[] = await executor
    .select(buildSsoPrincipalSelection())
    .from(organizationMemberships)
    .innerJoin(principals, eq(principals.id, organizationMemberships.principalId))
    .where(and(buildActiveOrganizationMembershipFilter(organizationId), eq(principals.id, principalId)))
    .limit(1);

  return rows[0];
}

function buildSsoPrincipalSelection(): SsoOidcPrincipalSelection {
  return {
    principalEmail: principals.email,
    principalId: principals.id,
    principalType: principals.type,
  };
}

type SsoOidcPrincipalExecutor = Pick<Database, 'select'>;
