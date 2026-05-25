import { count, eq } from 'drizzle-orm';
import { localCredentials, organizationMemberships, principals } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { buildOrganizationUserSelect, toOrganizationUserRow } from './organization-users.query.helpers';
import {
  buildOrganizationUserListOrderBy,
  buildOrganizationUsersListFilter,
} from './organization-users-list.query.helpers';
import type {
  ListOrganizationUsersPageInput,
  OrganizationUsersListPageResult,
} from './organization-users-list.query.types';
import type { OrganizationUserQueryRow } from './organization-users.query.types';

export async function listOrganizationUsersPage(
  input: ListOrganizationUsersPageInput,
): Promise<OrganizationUsersListPageResult> {
  const totalItems: number = await countOrganizationUsers(input.organizationId, input.search);
  const totalPages: number = Math.max(1, Math.ceil(totalItems / input.perPage));
  const page: number = Math.min(input.page, totalPages);
  const rows: OrganizationUserQueryRow[] = await getApiDatabase()
    .select(buildOrganizationUserSelect(input.organizationId))
    .from(organizationMemberships)
    .innerJoin(principals, eq(principals.id, organizationMemberships.principalId))
    .leftJoin(localCredentials, eq(localCredentials.principalId, principals.id))
    .where(buildOrganizationUsersListFilter(input.organizationId, input.search))
    .orderBy(...buildOrganizationUserListOrderBy(input.orderBy, input.sort, input.organizationId))
    .limit(input.perPage)
    .offset((page - 1) * input.perPage);

  return {
    pagination: {
      page,
      perPage: input.perPage,
      totalItems,
      totalPages,
    },
    users: rows.map(toOrganizationUserRow),
  };
}

async function countOrganizationUsers(organizationId: string, search: string | undefined): Promise<number> {
  const rows: { value: number }[] = await getApiDatabase()
    .select({ value: count() })
    .from(organizationMemberships)
    .innerJoin(principals, eq(principals.id, organizationMemberships.principalId))
    .leftJoin(localCredentials, eq(localCredentials.principalId, principals.id))
    .where(buildOrganizationUsersListFilter(organizationId, search));

  return rows[0]?.value ?? 0;
}
