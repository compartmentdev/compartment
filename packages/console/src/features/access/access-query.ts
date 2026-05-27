import { type QueryKey } from '@tanstack/react-query';

export const browserAccessQueryStaleTime: number = Number.POSITIVE_INFINITY;
const accessOrganizationUnavailableQueryKeyMarker: string = '$organization-unavailable';

export function readAccessOrganizationUnavailableQueryKey(surface: string, ...parts: string[]): QueryKey {
  return ['console-access', surface, accessOrganizationUnavailableQueryKeyMarker, ...parts];
}

export function requireBrowserAccessSelectedOrganizationSlug(selectedOrganizationSlug: string | null): string {
  if (selectedOrganizationSlug === null) {
    throw new Error('Expected selected organization.');
  }

  return selectedOrganizationSlug;
}

export function readAccessScopeOptionsQueryKey(organizationSlug: string): QueryKey {
  return ['console-access', 'scope-options', organizationSlug];
}

export function readAccessUsersAccessQueryKey(organizationSlug: string, email: string): QueryKey {
  return ['console-access', 'users', organizationSlug, 'access', email];
}

export function readAccessUsersListQueryKey(
  organizationSlug: string,
  page: number,
  pageSize: number,
  searchQuery: string,
  sortBy: string,
  sortDirection: string,
): QueryKey {
  return ['console-access', 'users', organizationSlug, 'list', page, pageSize, searchQuery, sortBy, sortDirection];
}

export function readAccessUsersOrganizationQueryKey(organizationSlug: string): QueryKey {
  return ['console-access', 'users', organizationSlug];
}

export function readAccessGroupsAssignmentsQueryKey(organizationSlug: string): QueryKey {
  return ['console-access', 'groups', organizationSlug, 'assignments'];
}

export function readAccessGroupsListQueryKey(
  organizationSlug: string,
  page?: number,
  pageSize?: number,
  searchQuery?: string,
  sortBy?: string,
  sortDirection?: string,
): QueryKey {
  return page === undefined
    ? ['console-access', 'groups', organizationSlug, 'list']
    : ['console-access', 'groups', organizationSlug, 'list', page, pageSize, searchQuery, sortBy, sortDirection];
}

export function readAccessGroupsOptionsQueryKey(organizationSlug: string): QueryKey {
  return ['console-access', 'groups', organizationSlug, 'options'];
}

export function readAccessGroupsMembersQueryKey(organizationSlug: string, groupId: string): QueryKey {
  return ['console-access', 'groups', organizationSlug, 'members', groupId];
}

export function readAccessGroupsOrganizationQueryKey(organizationSlug: string): QueryKey {
  return ['console-access', 'groups', organizationSlug];
}

export function readAccessRolesDetailQueryKey(organizationSlug: string, roleId: string): QueryKey {
  return ['console-access', 'roles', organizationSlug, 'detail', roleId];
}

export function readAccessRolesListQueryKey(
  organizationSlug: string,
  page?: number,
  pageSize?: number,
  searchQuery?: string,
  sortBy?: string,
  sortDirection?: string,
): QueryKey {
  return page === undefined
    ? ['console-access', 'roles', organizationSlug, 'list']
    : ['console-access', 'roles', organizationSlug, 'list', page, pageSize, searchQuery, sortBy, sortDirection];
}

export function readAccessRolesOptionsQueryKey(organizationSlug: string): QueryKey {
  return ['console-access', 'roles', organizationSlug, 'options'];
}

export function readAccessRolesOrganizationQueryKey(organizationSlug: string): QueryKey {
  return ['console-access', 'roles', organizationSlug];
}
