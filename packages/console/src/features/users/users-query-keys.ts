import { type QueryKey } from '@tanstack/react-query';
import {
  readAccessGroupsOptionsQueryKey,
  readAccessOrganizationUnavailableQueryKey,
  readAccessRolesOptionsQueryKey,
  readAccessScopeOptionsQueryKey,
  readAccessUsersAccessQueryKey,
  readAccessUsersListQueryKey,
} from '../access/access-query';
import type { UsersLoaderQuery } from './users-loader.helpers';

export interface UsersPageQueryKeys {
  access: QueryKey;
  groups: QueryKey;
  roles: QueryKey;
  scopeOptions: QueryKey;
  users: QueryKey;
}

export function readUsersPageQueryKeys(organizationSlug: string | null, query: UsersLoaderQuery): UsersPageQueryKeys {
  if (organizationSlug === null) {
    return readUsersPageOrganizationUnavailableQueryKeys(query);
  }

  return {
    access: readUsersAccessQueryKey(organizationSlug, query.selectedUserEmail),
    groups: readAccessGroupsOptionsQueryKey(organizationSlug),
    roles: readAccessRolesOptionsQueryKey(organizationSlug),
    scopeOptions: readAccessScopeOptionsQueryKey(organizationSlug),
    users: readAccessUsersListQueryKey(
      organizationSlug,
      query.page,
      query.pageSize,
      query.searchQuery,
      query.sortBy,
      query.sortDirection,
    ),
  };
}

function readUsersAccessQueryKey(organizationSlug: string, selectedUserEmail: string | null): QueryKey {
  return selectedUserEmail === null
    ? ['console-access', 'users', organizationSlug, 'access', 'unselected']
    : readAccessUsersAccessQueryKey(organizationSlug, selectedUserEmail);
}

function readUsersPageOrganizationUnavailableQueryKeys(query: UsersLoaderQuery): UsersPageQueryKeys {
  return {
    access: readAccessOrganizationUnavailableQueryKey('users', 'access', query.selectedUserEmail ?? 'none'),
    groups: readAccessOrganizationUnavailableQueryKey('users', 'groups'),
    roles: readAccessOrganizationUnavailableQueryKey('users', 'roles'),
    scopeOptions: readAccessOrganizationUnavailableQueryKey('users', 'scope-options'),
    users: readAccessOrganizationUnavailableQueryKey(
      'users',
      'list',
      String(query.page),
      String(query.pageSize),
      query.searchQuery,
      query.sortBy,
      query.sortDirection,
    ),
  };
}
