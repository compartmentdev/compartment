import { type QueryKey } from '@tanstack/react-query';
import {
  readAccessGroupsAssignmentsQueryKey,
  readAccessGroupsListQueryKey,
  readAccessGroupsMembersQueryKey,
  readAccessRolesOptionsQueryKey,
  readAccessOrganizationUnavailableQueryKey,
  readAccessScopeOptionsQueryKey,
} from '../access/access-query';
import type { GroupsLoaderQuery } from './groups-loader';

export interface GroupsPageQueryKeys {
  assignments: QueryKey;
  groups: QueryKey;
  members: QueryKey;
  roles: QueryKey;
  scopeOptions: QueryKey;
}

export function readGroupsPageQueryKeys(
  organizationSlug: string | null,
  query: GroupsLoaderQuery,
  selectedGroupId: string | null,
): GroupsPageQueryKeys {
  if (organizationSlug === null) {
    return readGroupsPageOrganizationUnavailableQueryKeys(query, selectedGroupId);
  }

  return {
    assignments: readAccessGroupsAssignmentsQueryKey(organizationSlug),
    groups: readAccessGroupsListQueryKey(
      organizationSlug,
      query.page,
      query.pageSize,
      query.searchQuery,
      query.sortBy,
      query.sortDirection,
    ),
    members: readGroupsMembersQueryKey(organizationSlug, selectedGroupId),
    roles: readAccessRolesOptionsQueryKey(organizationSlug),
    scopeOptions: readAccessScopeOptionsQueryKey(organizationSlug),
  };
}

function readGroupsMembersQueryKey(organizationSlug: string, selectedGroupId: string | null): QueryKey {
  return selectedGroupId === null
    ? ['console-access', 'groups', organizationSlug, 'members', 'unselected']
    : readAccessGroupsMembersQueryKey(organizationSlug, selectedGroupId);
}

function readGroupsPageOrganizationUnavailableQueryKeys(
  query: GroupsLoaderQuery,
  selectedGroupId: string | null,
): GroupsPageQueryKeys {
  return {
    assignments: readAccessOrganizationUnavailableQueryKey('groups', 'assignments'),
    groups: readAccessOrganizationUnavailableQueryKey(
      'groups',
      'list',
      String(query.page),
      String(query.pageSize),
      query.searchQuery,
      query.sortBy,
      query.sortDirection,
    ),
    members: readAccessOrganizationUnavailableQueryKey('groups', 'members', selectedGroupId ?? 'unselected'),
    roles: readAccessOrganizationUnavailableQueryKey('groups', 'roles'),
    scopeOptions: readAccessOrganizationUnavailableQueryKey('groups', 'scope-options'),
  };
}
