import type {
  AccessAssignmentScopeOptionsResponse,
  AccessGroupListResponse,
  AccessRoleListResponse,
  UserAccessDetailResponse,
  UserListResponse,
} from '@compartment/contracts/browser';
import type { BrowserUsersPageResult } from '../../services/browser-users.service.types';
import type { UsersLoaderQuery } from './users-loader.helpers';

export interface UsersPageQueryData {
  access: UserAccessDetailResponse | undefined;
  groups: AccessGroupListResponse;
  roles: AccessRoleListResponse;
  scopeOptions: AccessAssignmentScopeOptionsResponse;
  users: UserListResponse;
}

export function readInitialUsersPageQueryData(data: BrowserUsersPageResult): UsersPageQueryData {
  return {
    access: data.selectedUserAccess === null ? undefined : { access: data.selectedUserAccess },
    groups: { groups: data.availableGroups },
    roles: { roles: data.availableRoles },
    scopeOptions: { projects: data.scopeProjects },
    users: {
      pagination: {
        page: data.page,
        perPage: data.pageSize,
        totalItems: data.totalUsers,
        totalPages: data.totalPages,
      },
      users: data.users,
    },
  };
}

export function readUsersLoaderQueryFromPage(data: BrowserUsersPageResult): UsersLoaderQuery {
  return {
    errorMessage: data.errorMessage,
    mode: data.mode,
    noticeMessage: data.noticeMessage,
    page: data.page,
    pageSize: data.pageSize,
    searchQuery: data.searchQuery,
    selectedUserEmail: data.selectedUserEmail,
    sortBy: data.sortBy,
    sortDirection: data.sortDirection,
  };
}
