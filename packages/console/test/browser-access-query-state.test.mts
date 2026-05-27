import * as React from 'react';
import { QueryClientProvider, type QueryKey } from '@tanstack/react-query';
import {
  type AccessGroupListPageResponse,
  type AccessGroupListRow,
  compartmentCurrentOrganizationHeaderName,
  type AccessRoleListPageResponse,
  type AccessRoleListRow,
  type AccessRoleResponse,
  type PermissionKey,
  type UserListResponse,
} from '@compartment/contracts/browser';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest';
import { createJsonResponse } from './browser-test.fixtures';
import { type BrowserFetchCall, type FetchImplementation, readFetchPath } from './browser-client-pages.helpers';
import { browserQueryClient } from '../src/lib/browser-query-client';
import type { BrowserGroupsPageResult } from '../src/services/browser-groups.service.types';
import type { BrowserRolesPageResult } from '../src/services/browser-roles.service.types';
import type { BrowserUsersPageResult, BrowserUsersUser } from '../src/services/browser-users.service.types';
import {
  readAccessGroupsListQueryKey,
  readAccessGroupsOptionsQueryKey,
  readAccessGroupsOrganizationQueryKey,
  readAccessRolesListQueryKey,
  readAccessRolesOptionsQueryKey,
  readAccessRolesOrganizationQueryKey,
  readAccessUsersListQueryKey,
  readAccessUsersOrganizationQueryKey,
} from '../src/features/access/access-query';
import { readBrowserConsoleWhoAmIQueryKey } from '../src/features/console/console-query';
import { readGroupDeleteConfirmationSpec } from '../src/features/groups/groups-page.actions';
import { invalidateGroupsAccessQueries } from '../src/features/groups/groups-query-invalidate';
import { handleRoleDelete, readRoleDeleteConfirmationSpec } from '../src/features/roles/roles-page.actions';
import { invalidateUserAccessQueries } from '../src/features/users/users-query-invalidation';
import { readUserRemoveConfirmationSpec } from '../src/features/users/user-actions';
import { useGroupsPageQueryData } from '../src/features/groups/groups-query-state';
import { useRolesPageQueryData } from '../src/features/roles/roles-query-state';
import { useUsersPageQueryData } from '../src/features/users/users-query-state';

afterEach((): void => {
  browserQueryClient.clear();
  vi.unstubAllGlobals();
});

describe('browser access query state', (): void => {
  it('keeps users list data scoped to the selected organization slug', (): void => {
    browserQueryClient.setQueryData(
      readAccessUsersListQueryKey('beta-dev', 1, 10, '', 'email', 'asc'),
      createUserListResponse('beta@example.com'),
    );
    browserQueryClient.setQueryData(
      readAccessUsersListQueryKey('acme-dev', 1, 10, '', 'email', 'asc'),
      createUserListResponse('acme@example.com'),
    );

    const markup: string = renderWithBrowserQueryClient(
      React.createElement(UsersQueryProbe, {
        data: createUsersPageResult({ users: [createUser('loader@example.com')] }),
      }),
    );

    expect(markup).toContain('acme@example.com');
    expect(markup).not.toContain('beta@example.com');
    expect(markup).not.toContain('loader@example.com');
  });

  it('keeps unavailable organization states off stale empty-slug access cache entries', (): void => {
    browserQueryClient.setQueryData(
      readAccessUsersListQueryKey('', 1, 10, '', 'email', 'asc'),
      createUserListResponse('ghost@example.com'),
    );

    const markup: string = renderWithBrowserQueryClient(
      React.createElement(UsersQueryProbe, {
        data: createUsersPageResult({
          organizationContext: {
            kind: 'organization_required',
            requestedOrganizationSlug: null,
            selectedOrganizationSlug: null,
          },
          selectedOrganizationSlug: null,
          users: [],
        }),
      }),
    );

    expect(markup).toContain('empty');
    expect(markup).not.toContain('ghost@example.com');
  });

  it('keeps groups list data scoped to the selected organization slug', (): void => {
    browserQueryClient.setQueryData(
      readAccessGroupsListQueryKey('beta-dev', 1, 10, '', 'name', 'asc'),
      createGroupListPageResponse('group_beta', 'Beta group'),
    );
    browserQueryClient.setQueryData(
      readAccessGroupsListQueryKey('acme-dev', 1, 10, '', 'name', 'asc'),
      createGroupListPageResponse('group_acme', 'Acme group'),
    );

    const markup: string = renderWithBrowserQueryClient(
      React.createElement(GroupsQueryProbe, {
        data: createGroupsPageResult({ groups: [createGroupListRow('group_loader', 'Loader group')] }),
      }),
    );

    expect(markup).toContain('Acme group');
    expect(markup).not.toContain('Beta group');
    expect(markup).not.toContain('Loader group');
  });

  it('keeps a selected group detail open when the cache is stale during create-to-detail navigation', (): void => {
    const selectedGroup: AccessGroupListRow = createGroupListRow('group_new', 'New group');
    browserQueryClient.setQueryData(readAccessGroupsListQueryKey('acme-dev'), {
      groups: [createGroupListRow('group_old', 'Old group')],
    });

    const markup: string = renderWithBrowserQueryClient(
      React.createElement(GroupsQueryStateProbe, {
        data: createGroupsPageResult({
          groups: [selectedGroup],
          mode: 'detail',
          selectedGroupId: selectedGroup.id,
        }),
      }),
    );

    expect(markup).toContain('detail');
    expect(markup).toContain('group_new');
    expect(markup).toContain('New group');
    expect(markup).not.toContain('group_old');
    expect(markup).not.toContain('Old group');
  });

  it('keeps a selected group detail open when the selected group is outside the current page slice', (): void => {
    const selectedGroup: AccessGroupListRow = createGroupListRow('group_selected', 'Selected group');

    const markup: string = renderWithBrowserQueryClient(
      React.createElement(GroupsSelectionProbe, {
        data: createGroupsPageResult({
          groups: [createGroupListRow('group_page', 'Paged group')],
          mode: 'detail',
          selectedGroup: selectedGroup,
          selectedGroupId: selectedGroup.id,
        }),
      }),
    );

    expect(markup).toContain('detail');
    expect(markup).toContain('group_selected');
    expect(markup).toContain('Selected group');
  });

  it('keeps groups unavailable organization states off stale empty-slug access cache entries', (): void => {
    browserQueryClient.setQueryData(readAccessGroupsListQueryKey(''), {
      groups: [createGroupListRow('group_ghost', 'Ghost group')],
    });

    const markup: string = renderWithBrowserQueryClient(
      React.createElement(GroupsQueryProbe, {
        data: createGroupsPageResult({
          groups: [],
          organizationContext: {
            kind: 'organization_unavailable',
            requestedOrganizationSlug: 'hidden-org',
            selectedOrganizationSlug: null,
          },
          selectedOrganizationSlug: null,
        }),
      }),
    );

    expect(markup).toContain('empty');
    expect(markup).not.toContain('Ghost group');
  });

  it('keeps unavailable organization states off valid slug-shaped cache entries', (): void => {
    browserQueryClient.setQueryData(readAccessRolesListQueryKey('organization-unavailable'), {
      roles: [createRoleListRow('role_collision', 'Collision role')],
    });

    const markup: string = renderWithBrowserQueryClient(
      React.createElement(RolesQueryProbe, {
        data: createRolesPageResult({
          organizationContext: {
            kind: 'organization_unavailable',
            requestedOrganizationSlug: 'hidden-org',
            selectedOrganizationSlug: null,
          },
          roles: [],
          selectedOrganizationSlug: null,
        }),
      }),
    );

    expect(markup).toContain('empty');
    expect(markup).not.toContain('Collision role');
  });

  it('keeps roles list data scoped to the selected organization slug', (): void => {
    browserQueryClient.setQueryData(
      readAccessRolesListQueryKey('beta-dev', 1, 10, '', 'name', 'asc'),
      createRoleListPageResponse('role_beta', 'Beta role'),
    );
    browserQueryClient.setQueryData(
      readAccessRolesListQueryKey('acme-dev', 1, 10, '', 'name', 'asc'),
      createRoleListPageResponse('role_acme', 'Acme role'),
    );

    const markup: string = renderWithBrowserQueryClient(
      React.createElement(RolesQueryProbe, {
        data: createRolesPageResult({ roles: [createRoleListRow('role_loader', 'Loader role')] }),
      }),
    );

    expect(markup).toContain('Acme role');
    expect(markup).not.toContain('Beta role');
    expect(markup).not.toContain('Loader role');
  });

  it('keeps a selected role detail open when the selected role is outside the current page slice', (): void => {
    const selectedRole: AccessRoleListRow = createRoleListRow('role_selected', 'Selected role');

    const markup: string = renderWithBrowserQueryClient(
      React.createElement(RolesSelectionProbe, {
        data: createRolesPageResult({
          mode: 'detail',
          role: {
            description: selectedRole.description,
            id: selectedRole.id,
            kind: selectedRole.kind,
            name: selectedRole.name,
            permissionKeys: selectedRole.permissionKeys,
          },
          roleId: selectedRole.id,
          roles: [createRoleListRow('role_page', 'Paged role')],
        }),
      }),
    );

    expect(markup).toContain('detail');
    expect(markup).toContain('role_selected');
    expect(markup).toContain('Selected role');
  });

  it('invalidates role mutations inside the selected organization only', async (): Promise<void> => {
    const acmeRolesListKey: QueryKey = readAccessRolesListQueryKey('acme-dev', 1, 10, '', 'name', 'asc');
    const betaRolesListKey: QueryKey = readAccessRolesListQueryKey('beta-dev', 1, 10, '', 'name', 'asc');
    browserQueryClient.setQueryData(acmeRolesListKey, createRoleListPageResponse('role_acme', 'Acme role'));
    browserQueryClient.setQueryData(betaRolesListKey, createRoleListPageResponse('role_beta', 'Beta role'));
    browserQueryClient.setQueryData(readAccessRolesOrganizationQueryKey('acme-dev'), { stale: false });
    browserQueryClient.setQueryData(readAccessGroupsOrganizationQueryKey('acme-dev'), { stale: false });
    browserQueryClient.setQueryData(readAccessUsersOrganizationQueryKey('acme-dev'), { stale: false });
    browserQueryClient.setQueryData(readBrowserConsoleWhoAmIQueryKey('acme-dev'), { stale: false });

    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>(async (): Promise<Response> => {
      await Promise.resolve();
      return createJsonResponse(createRoleResponse('role_123', 'Viewer'));
    });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      handleRoleDelete(createRoleListRow('role_123', 'Viewer'), createRolesPageResult(), (): void => undefined),
    ).resolves.toBe(true);

    const firstCall: BrowserFetchCall = fetchMock.mock.calls[0]!;
    expect(readFetchPath(firstCall[0])).toBe('/v1/roles/role_123');
    expect(new Headers(firstCall[1]?.headers).get(compartmentCurrentOrganizationHeaderName)).toBe('acme-dev');
    expect(browserQueryClient.getQueryState(acmeRolesListKey)?.isInvalidated).toBe(true);
    expect(browserQueryClient.getQueryState(betaRolesListKey)?.isInvalidated).toBe(false);
  });

  it('invalidates role and group option caches after user access mutations', async (): Promise<void> => {
    const rolesOptionsKey: QueryKey = readAccessRolesOptionsQueryKey('acme-dev');
    const groupsOptionsKey: QueryKey = readAccessGroupsOptionsQueryKey('acme-dev');
    browserQueryClient.setQueryData(rolesOptionsKey, { stale: false });
    browserQueryClient.setQueryData(groupsOptionsKey, { stale: false });

    await invalidateUserAccessQueries(createUsersPageResult());

    expect(browserQueryClient.getQueryState(rolesOptionsKey)?.isInvalidated).toBe(true);
    expect(browserQueryClient.getQueryState(groupsOptionsKey)?.isInvalidated).toBe(true);
  });

  it('invalidates roles together with groups after group-side mutations', async (): Promise<void> => {
    const groupsKey: QueryKey = readAccessGroupsOrganizationQueryKey('acme-dev');
    const rolesKey: QueryKey = readAccessRolesOrganizationQueryKey('acme-dev');
    browserQueryClient.setQueryData(groupsKey, { stale: false });
    browserQueryClient.setQueryData(rolesKey, { stale: false });

    await invalidateGroupsAccessQueries(createGroupsPageResult());

    expect(browserQueryClient.getQueryState(groupsKey)?.isInvalidated).toBe(true);
    expect(browserQueryClient.getQueryState(rolesKey)?.isInvalidated).toBe(true);
  });

  it('renders typed confirmation copy for role, group, and user destructive actions', (): void => {
    expect(readRoleDeleteConfirmationSpec('Viewer').description).toBe('Type Viewer to remove this role.');
    expect(readGroupDeleteConfirmationSpec('Operators').description).toBe('Type Operators to delete this group.');
    expect(readUserRemoveConfirmationSpec('viewer@example.com').description).toBe(
      'Type viewer@example.com to remove this user.',
    );
  });
});

function renderWithBrowserQueryClient(element: React.ReactElement): string {
  return renderToStaticMarkup(React.createElement(QueryClientProvider, { client: browserQueryClient }, element));
}

function UsersQueryProbe({ data }: Readonly<{ data: BrowserUsersPageResult }>): React.ReactElement {
  const queryData: BrowserUsersPageResult = useUsersPageQueryData(data);
  const emails: string = queryData.users.map((user: BrowserUsersUser): string => user.email).join(',');
  return React.createElement('output', null, emails === '' ? 'empty' : emails);
}

function GroupsQueryProbe({ data }: Readonly<{ data: BrowserGroupsPageResult }>): React.ReactElement {
  const queryData: BrowserGroupsPageResult = useGroupsPageQueryData(data);
  const groupNames: string = queryData.groups.map((group: AccessGroupListRow): string => group.name).join(',');
  return React.createElement('output', null, groupNames === '' ? 'empty' : groupNames);
}

function GroupsQueryStateProbe({ data }: Readonly<{ data: BrowserGroupsPageResult }>): React.ReactElement {
  const queryData: BrowserGroupsPageResult = useGroupsPageQueryData(data);
  return React.createElement(
    'output',
    null,
    `${queryData.mode}:${queryData.selectedGroupId ?? 'none'}:${queryData.groups
      .map((group: AccessGroupListRow): string => group.name)
      .join(',')}`,
  );
}

function GroupsSelectionProbe({ data }: Readonly<{ data: BrowserGroupsPageResult }>): React.ReactElement {
  const queryData: BrowserGroupsPageResult = useGroupsPageQueryData(data);
  return React.createElement(
    'output',
    null,
    `${queryData.mode}:${queryData.selectedGroupId ?? 'none'}:${queryData.selectedGroup?.name ?? 'none'}`,
  );
}

function RolesQueryProbe({ data }: Readonly<{ data: BrowserRolesPageResult }>): React.ReactElement {
  const queryData: BrowserRolesPageResult = useRolesPageQueryData(data);
  const roleNames: string = queryData.roles.map((role: AccessRoleListRow): string => role.name).join(',');
  return React.createElement('output', null, roleNames === '' ? 'empty' : roleNames);
}

function RolesSelectionProbe({ data }: Readonly<{ data: BrowserRolesPageResult }>): React.ReactElement {
  const queryData: BrowserRolesPageResult = useRolesPageQueryData(data);
  return React.createElement(
    'output',
    null,
    `${queryData.mode}:${queryData.roleId ?? 'none'}:${queryData.role?.name ?? 'none'}`,
  );
}

function createUsersPageResult(overrides: Partial<BrowserUsersPageResult> = {}): BrowserUsersPageResult {
  return {
    availableGroups: [],
    availableRoles: [],
    currentOrganizationPermissions: createAccessManagementPermissions(),
    mode: 'list',
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [{ id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' }],
    page: 1,
    pageSize: 10,
    pageSizeOptions: [10, 20, 50],
    principalEmail: 'admin@example.com',
    projectCount: 1,
    scopeProjects: [],
    searchQuery: '',
    selectedOrganizationSlug: 'acme-dev',
    selectedUserAccess: null,
    selectedUserEmail: null,
    showOrganizationSelector: false,
    sortBy: 'email',
    sortDirection: 'asc',
    totalPages: 1,
    totalUsers: 1,
    users: [createUser('loader@example.com')],
    ...overrides,
  };
}

function createRolesPageResult(overrides: Partial<BrowserRolesPageResult> = {}): BrowserRolesPageResult {
  const roles: AccessRoleListRow[] = overrides.roles ?? [createRoleListRow('role_loader', 'Loader role')];
  return {
    currentOrganizationPermissions: createAccessManagementPermissions(),
    mode: 'list',
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [{ id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' }],
    page: 1,
    pageSize: 10,
    pageSizeOptions: [10, 20, 50],
    permissionKeys: ['project.read'],
    principalEmail: 'admin@example.com',
    projectCount: 1,
    role: null,
    roleId: null,
    roles,
    searchQuery: '',
    selectedOrganizationSlug: 'acme-dev',
    showOrganizationSelector: false,
    sortBy: 'name',
    sortDirection: 'asc',
    totalPages: 1,
    totalRoles: roles.length,
    ...overrides,
  };
}

function createGroupsPageResult(overrides: Partial<BrowserGroupsPageResult> = {}): BrowserGroupsPageResult {
  const groups: AccessGroupListRow[] = overrides.groups ?? [createGroupListRow('group_loader', 'Loader group')];
  return {
    assignments: [],
    currentOrganizationPermissions: createAccessManagementPermissions(),
    groups,
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
    selectedGroupId: null,
    selectedOrganizationSlug: 'acme-dev',
    showOrganizationSelector: false,
    sortBy: 'name',
    sortDirection: 'asc',
    totalGroups: groups.length,
    totalPages: 1,
    ...overrides,
  };
}

function createAccessManagementPermissions(): PermissionKey[] {
  return [
    'organization.user.read',
    'organization.user.invite',
    'organization.user.block',
    'organization.user.remove',
    'organization.user.credentials.reset',
    'organization.group.read',
    'organization.group.manage',
    'organization.role.read',
    'organization.role.manage',
  ];
}

function createUserListResponse(email: string): UserListResponse {
  return {
    pagination: {
      page: 1,
      perPage: 10,
      totalItems: 1,
      totalPages: 1,
    },
    users: [createUser(email)],
  };
}

function createGroupListRow(id: string, name: string): AccessGroupListRow {
  return {
    assignedRoleNames: ['Viewer'],
    assignmentCount: 0,
    assignmentScopeLabels: [],
    description: null,
    id,
    memberCount: 0,
    name,
  };
}

function createGroupListPageResponse(id: string, name: string): AccessGroupListPageResponse {
  return {
    detail: 'list',
    groups: [createGroupListRow(id, name)],
    pagination: {
      page: 1,
      perPage: 10,
      totalItems: 1,
      totalPages: 1,
    },
  };
}

function createUser(email: string): BrowserUsersUser {
  return {
    access: 'allowed',
    accessSummary: 'Limited view',
    directAccessScopeLabels: [],
    email,
    groupCount: 0,
    groupNames: [],
    id: `usr_${email.replace(/[^a-z0-9]/giu, '_')}`,
    roleNames: ['viewer'],
    status: 'active',
    type: 'user',
  };
}

function createRoleListPageResponse(id: string, name: string): AccessRoleListPageResponse {
  return {
    detail: 'list',
    pagination: {
      page: 1,
      perPage: 10,
      totalItems: 1,
      totalPages: 1,
    },
    roles: [createRoleListRow(id, name)],
  };
}

function createRoleResponse(id: string, name: string): AccessRoleResponse {
  return {
    role: {
      description: null,
      id,
      kind: 'custom',
      name,
      permissionKeys: ['project.read'],
    },
  };
}

function createRoleListRow(id: string, name: string): AccessRoleListRow {
  return {
    assignmentCount: 0,
    description: null,
    groupCount: 0,
    id,
    kind: 'custom',
    name,
    permissionKeys: ['project.read'],
    principalCount: 0,
  };
}
