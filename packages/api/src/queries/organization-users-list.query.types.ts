import type { ListPagination, ListSortDirection, UserListOrderBy } from '@compartment/contracts';
import type { OrganizationUserRow } from './organization-users.query.types';

export interface ListOrganizationUsersPageInput {
  organizationId: string;
  orderBy: UserListOrderBy;
  page: number;
  perPage: number;
  search?: string | undefined;
  sort: ListSortDirection;
}

export interface OrganizationUsersListPageResult {
  pagination: ListPagination;
  users: OrganizationUserRow[];
}
