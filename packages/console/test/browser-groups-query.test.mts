import { describe, expect, it } from 'vitest';
import { buildGroupsPageHref, readNextGroupsSortDirection } from '../src/features/groups/groups-page.href';
import type { BrowserGroupsPageResult } from '../src/services/browser-groups.service.types';

describe('browser groups hrefs', (): void => {
  it('omits default list params while preserving selected group detail state', (): void => {
    expect(buildGroupsPageHref(createGroupsPageResult(), 'grp_123', 'detail')).toBe(
      '/orgs/acme-dev/groups?groupId=grp_123',
    );
  });

  it('includes non-default search, sorting, and paging params in group hrefs', (): void => {
    expect(
      buildGroupsPageHref(createGroupsPageResult(), null, 'list', {
        page: 2,
        pageSize: 20,
        searchQuery: 'ops',
        sortBy: 'memberCount',
        sortDirection: 'desc',
      }),
    ).toBe('/orgs/acme-dev/groups?q=ops&sortBy=memberCount&sortDirection=desc&page=2&pageSize=20');
  });

  it('uses descending defaults for count-based sorts and asc for a new name sort', (): void => {
    const data: BrowserGroupsPageResult = createGroupsPageResult();

    expect(readNextGroupsSortDirection(data, 'memberCount')).toBe('desc');
    expect(readNextGroupsSortDirection(data, 'name')).toBe('desc');
  });
});

function createGroupsPageResult(): BrowserGroupsPageResult {
  return {
    assignments: [],
    currentOrganizationPermissions: ['organization.group.read'],
    groups: [],
    members: [],
    mode: 'list',
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [{ id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' }],
    page: 1,
    pageSize: 10,
    pageSizeOptions: [10, 20, 50],
    principalEmail: 'admin@example.com',
    projectCount: 1,
    roles: [],
    searchQuery: '',
    scopeProjects: [],
    selectedGroup: null,
    selectedGroupId: null,
    selectedOrganizationSlug: 'acme-dev',
    showOrganizationSelector: false,
    sortBy: 'name',
    sortDirection: 'asc',
    totalGroups: 0,
    totalPages: 1,
  };
}
