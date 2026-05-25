import { type QueryKey } from '@tanstack/react-query';
import {
  readAccessGroupsAssignmentsQueryKey,
  readAccessGroupsListQueryKey,
  readAccessGroupsMembersQueryKey,
  readAccessOrganizationUnavailableQueryKey,
  readAccessRolesListQueryKey,
  readAccessScopeOptionsQueryKey,
} from '../access/access-query';

export interface GroupsPageQueryKeys {
  assignments: QueryKey;
  groups: QueryKey;
  members: QueryKey;
  roles: QueryKey;
  scopeOptions: QueryKey;
}

export function readGroupsPageQueryKeys(
  organizationSlug: string | null,
  selectedGroupId: string | null,
): GroupsPageQueryKeys {
  if (organizationSlug === null) {
    return readGroupsPageOrganizationUnavailableQueryKeys(selectedGroupId);
  }

  return {
    assignments: readAccessGroupsAssignmentsQueryKey(organizationSlug),
    groups: readAccessGroupsListQueryKey(organizationSlug),
    members: readGroupsMembersQueryKey(organizationSlug, selectedGroupId),
    roles: readAccessRolesListQueryKey(organizationSlug),
    scopeOptions: readAccessScopeOptionsQueryKey(organizationSlug),
  };
}

function readGroupsMembersQueryKey(organizationSlug: string, selectedGroupId: string | null): QueryKey {
  return selectedGroupId === null
    ? ['console-access', 'groups', organizationSlug, 'members', 'unselected']
    : readAccessGroupsMembersQueryKey(organizationSlug, selectedGroupId);
}

function readGroupsPageOrganizationUnavailableQueryKeys(selectedGroupId: string | null): GroupsPageQueryKeys {
  return {
    assignments: readAccessOrganizationUnavailableQueryKey('groups', 'assignments'),
    groups: readAccessOrganizationUnavailableQueryKey('groups', 'list'),
    members: readAccessOrganizationUnavailableQueryKey('groups', 'members', selectedGroupId ?? 'unselected'),
    roles: readAccessOrganizationUnavailableQueryKey('groups', 'roles'),
    scopeOptions: readAccessOrganizationUnavailableQueryKey('groups', 'scope-options'),
  };
}
