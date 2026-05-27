import { type ListSortDirection, type OrganizationUserType, type UserListOrderBy } from '@compartment/contracts';
import { hasText } from '@compartment/utils';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { principals } from '../db/schema';
import {
  buildOrganizationMembershipFilter,
  buildOrganizationUserAccessText,
  buildOrganizationUserIsActiveExpression,
  buildOrganizationUserStatusText,
  buildOrganizationUserTypeSearchText,
} from './organization-users.query.helpers';

export function buildOrganizationUsersListFilter(
  organizationId: string,
  search: string | undefined,
  type: OrganizationUserType | undefined,
): SQL | undefined {
  const baseFilter: SQL | undefined = buildOrganizationUsersBaseFilter(organizationId, type);
  const searchFilter: SQL | undefined = buildOrganizationUsersSearchFilter(organizationId, search);

  if (searchFilter === undefined) {
    return baseFilter;
  }

  return and(baseFilter, searchFilter);
}

export function buildOrganizationUserListOrderBy(
  orderBy: UserListOrderBy,
  sort: ListSortDirection,
  organizationId: string,
): SQL[] {
  const direction: typeof asc | typeof desc = sort === 'asc' ? asc : desc;

  switch (orderBy) {
    case 'email':
      return [direction(buildOrganizationUserEmailSortExpression()), direction(principals.email)];
    case 'status':
      return [
        direction(buildOrganizationUserStatusRankExpression(organizationId)),
        asc(buildOrganizationUserEmailSortExpression()),
        asc(principals.email),
      ];
  }
}

function buildOrganizationUsersSearchFilter(organizationId: string, search: string | undefined): SQL | undefined {
  if (!hasText(search)) {
    return undefined;
  }

  const normalizedSearch: string = buildOrganizationUsersSearchPattern(search);

  return sql`
    lower(concat_ws(' ', ${principals.email}, ${buildOrganizationUserStatusText(organizationId)}, ${buildOrganizationUserAccessText()}, ${buildOrganizationUserTypeSearchText()}))
    like ${normalizedSearch}
    escape '\\'
  `;
}

function buildOrganizationUsersBaseFilter(
  organizationId: string,
  type: OrganizationUserType | undefined,
): SQL | undefined {
  const organizationFilter: SQL | undefined = buildOrganizationMembershipFilter(organizationId);
  const typeFilter: SQL | undefined = buildOrganizationUserTypeFilter(type);

  return typeFilter === undefined ? organizationFilter : and(organizationFilter, typeFilter);
}

function buildOrganizationUserTypeFilter(type: OrganizationUserType | undefined): SQL | undefined {
  if (type === undefined) {
    return undefined;
  }

  return eq(principals.type, type);
}

function buildOrganizationUserEmailSortExpression(): SQL<string> {
  return sql<string>`lower(${principals.email})`;
}

function buildOrganizationUserStatusRankExpression(organizationId: string): SQL<number> {
  return sql<number>`case when ${buildOrganizationUserIsActiveExpression(organizationId)} then 0 else 1 end`;
}

function buildOrganizationUsersSearchPattern(search: string): string {
  const normalizedSearch: string = search.trim().toLowerCase();
  const escapedSearch: string = normalizedSearch.replace(/([\\%_])/gu, '\\$1');

  return `%${escapedSearch}%`;
}
