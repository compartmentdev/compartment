import { browserQueryClient, invalidateBrowserQueries } from '../../lib/browser-query-client';
import type { BrowserGroupsPageResult } from '../../services/browser-groups.service.types';
import {
  readAccessGroupsOrganizationQueryKey,
  readAccessRolesOrganizationQueryKey,
  readAccessUsersOrganizationQueryKey,
} from '../access/access-query';
import { invalidateBrowserConsolePermissionQueries } from '../console/console-query';

export async function invalidateGroupsAccessQueries(data: BrowserGroupsPageResult): Promise<void> {
  if (data.selectedOrganizationSlug === null) {
    return;
  }

  await Promise.all([
    invalidateBrowserConsolePermissionQueries(data.selectedOrganizationSlug),
    invalidateBrowserQueries(browserQueryClient, readAccessGroupsOrganizationQueryKey(data.selectedOrganizationSlug)),
    invalidateBrowserQueries(browserQueryClient, readAccessRolesOrganizationQueryKey(data.selectedOrganizationSlug)),
    invalidateBrowserQueries(browserQueryClient, readAccessUsersOrganizationQueryKey(data.selectedOrganizationSlug)),
  ]);
}
