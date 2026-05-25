import { browserQueryClient, invalidateBrowserQueries } from '../../lib/browser-query-client';
import type { BrowserUsersPageResult } from '../../services/browser-users.service.types';
import {
  readAccessGroupsListQueryKey,
  readAccessRolesListQueryKey,
  readAccessUsersOrganizationQueryKey,
} from '../access/access-query';
import { invalidateBrowserConsolePermissionQueries } from '../console/console-query';

export async function invalidateUsersListQueries(data: BrowserUsersPageResult): Promise<void> {
  if (data.selectedOrganizationSlug === null) {
    return;
  }

  await Promise.all([
    invalidateBrowserConsolePermissionQueries(data.selectedOrganizationSlug),
    invalidateBrowserQueries(browserQueryClient, readAccessUsersOrganizationQueryKey(data.selectedOrganizationSlug)),
  ]);
}

export async function invalidateUserAccessQueries(data: BrowserUsersPageResult): Promise<void> {
  if (data.selectedOrganizationSlug === null) {
    return;
  }

  await Promise.all([
    invalidateBrowserConsolePermissionQueries(data.selectedOrganizationSlug),
    invalidateBrowserQueries(browserQueryClient, readAccessUsersOrganizationQueryKey(data.selectedOrganizationSlug)),
    invalidateBrowserQueries(browserQueryClient, readAccessRolesListQueryKey(data.selectedOrganizationSlug)),
    invalidateBrowserQueries(browserQueryClient, readAccessGroupsListQueryKey(data.selectedOrganizationSlug)),
  ]);
}
