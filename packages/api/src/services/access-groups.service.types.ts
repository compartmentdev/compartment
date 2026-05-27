import type { AccessGroupListOrderBy, AddAccessGroupMemberRequest, ListSortDirection } from '@compartment/contracts';
import type { ListPagination } from './list-pagination.service.helpers';

export interface AddOrganizationAccessGroupMemberInput {
  actorPrincipalId: string;
  groupId: string;
  organizationId: string;
  request: AddAccessGroupMemberRequest;
}

export interface AccessGroupResult {
  assignmentCount: number;
  description: string | null;
  id: string;
  memberCount: number;
  name: string;
}

export interface AccessGroupListRowResult extends AccessGroupResult {
  assignedRoleNames: string[];
  assignmentScopeLabels: string[];
}

export interface AccessGroupMemberResult {
  email: string;
  id: string;
  status: 'active' | 'invited';
}

export interface AccessGroupMemberMutationResult {
  changed: boolean;
  members: AccessGroupMemberResult[];
}

export interface ListOrganizationAccessGroupsPageInput {
  organizationId: string;
  orderBy?: AccessGroupListOrderBy | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  search?: string | undefined;
  sort?: ListSortDirection | undefined;
}

export interface OrganizationAccessGroupsPageResult {
  groups: AccessGroupListRowResult[];
  pagination: ListPagination;
}
