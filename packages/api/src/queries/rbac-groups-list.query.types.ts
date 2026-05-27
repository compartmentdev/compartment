import type { AccessGroupListOrderBy, ListPagination, ListSortDirection } from '@compartment/contracts';

export interface ListAccessGroupsPageInput {
  organizationId: string;
  orderBy: AccessGroupListOrderBy;
  page: number;
  perPage: number;
  search?: string | undefined;
  sort: ListSortDirection;
}

export interface AccessGroupListPageRow {
  assignmentCount: number;
  createdAt: Date;
  description: string | null;
  id: string;
  memberCount: number;
  name: string;
  organizationId: string;
  updatedAt: Date;
}

export interface AccessGroupsPageResult {
  groups: AccessGroupListPageRow[];
  pagination: ListPagination;
}
