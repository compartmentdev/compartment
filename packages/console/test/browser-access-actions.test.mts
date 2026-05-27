import * as React from 'react';
import type { AccessGroupListRow, AccessRoleListRow, PermissionKey } from '@compartment/contracts/browser';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserSoftNavigateHandler } from '../src/browser-soft-navigation';
import type { BrowserGroupsPageResult } from '../src/services/browser-groups.service.types';
import type { BrowserOrganizationOption } from '../src/services/browser-organization.service.types';
import type { BrowserRolesPageResult } from '../src/services/browser-roles.service.types';
import type { BrowserUsersPageResult, BrowserUsersUser } from '../src/services/browser-users.service.types';
import { GroupDetailDrawerContent } from '../src/features/groups/groups-page.detail-drawer';
import { GroupsPageContent } from '../src/features/groups/groups-page.sections';
import type { GroupsPageState } from '../src/features/groups/groups-page.state';
import { RolesPageContent } from '../src/features/roles/roles-page.sections';
import type { RolesPageState } from '../src/features/roles/roles-page.state';
import type { UserActionHandler } from '../src/features/users/user-actions';
import { UsersView } from '../src/features/users/users-view';

afterEach((): void => {
  vi.unstubAllGlobals();
});

describe('browser access action visibility', (): void => {
  it('hides user mutation actions from read-only users', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(UsersView, {
        data: createUsersPageResult(['organization.user.read']),
        onNavigate: vi.fn<BrowserSoftNavigateHandler>(),
        onUserAction: vi.fn<UserActionHandler>(),
        setData: vi.fn(),
      }),
    );

    expect(html).not.toContain('Invite user');
    expect(html).not.toContain('Open actions for viewer@example.com');
    expect(html).not.toContain('Manage organization members, direct grants, and shared access through groups.');
  });

  it('hides group create and delete actions from read-only group viewers', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(GroupsPageContent, {
        state: createGroupsPageState(['organization.group.read'], [createGroup()]),
      }),
    );

    expect(html).not.toContain('Create group');
    expect(html).not.toContain('Open actions for Operators');
  });

  it('hides group assignments when role data is unavailable', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(GroupDetailDrawerContent, {
        isEditing: false,
        setIsEditing: (): void => undefined,
        state: createGroupDetailPageState(['organization.group.read']),
      }),
    );

    expect(html).not.toContain('Assignments');
    expect(html).not.toContain('No assignments.');
    expect(html).not.toContain('Effective permissions');
    expect(html).not.toContain('projects');
  });

  it('renders an accent invite user action for organization admins', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(UsersView, {
        data: createUsersPageResult(['organization.user.read', 'organization.user.invite']),
        onNavigate: vi.fn<BrowserSoftNavigateHandler>(),
        onUserAction: vi.fn<UserActionHandler>(),
        setData: vi.fn(),
      }),
    );

    expect(html).toContain('Invite user');
    expect(html).toContain('button-accent-surface');
    expect(html).toContain('lucide-user-plus');
  });

  it('renders an accent create group action for group managers', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(GroupsPageContent, {
        state: createGroupsPageState(['organization.group.read', 'organization.group.manage'], [createGroup()]),
      }),
    );

    expect(html).toContain('Create group');
    expect(html).toContain('button-accent-surface');
    expect(html).toContain('lucide-users-round');
    expect(html).not.toContain('Manage shared access groups and their members.');
  });

  it('renders a users empty state action with the accent button', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(UsersView, {
        data: createUsersPageResult(['organization.user.read', 'organization.user.invite'], {
          users: [createCurrentPrincipalUser()],
        }),
        onNavigate: vi.fn<BrowserSoftNavigateHandler>(),
        onUserAction: vi.fn<UserActionHandler>(),
        setData: vi.fn(),
      }),
    );

    expect(html).toContain('You do not have any invited users.');
    expect(html).toContain('Invite user');
    expect(html).toContain('button-accent-surface');
    expect(html).toContain('empty-states/users.svg');
    expect(html).toContain('lucide-mail-plus');
    expect(html).not.toContain('Search users');
  });

  it('renders a groups empty state action with the accent button', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(GroupsPageContent, {
        state: createGroupsPageState(['organization.group.read', 'organization.group.manage']),
      }),
    );

    expect(html).toContain('You do not have any groups.');
    expect(html).toContain('Create group');
    expect(html).toContain('button-accent-surface');
    expect(html).toContain('empty-states/groups.svg');
    expect(html).toContain('lucide-plus');
    expect(html).not.toContain('Search groups');
  });

  it('hides role create and delete actions from read-only role viewers', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(RolesPageContent, {
        state: createRolesPageState(['organization.role.read']),
      }),
    );

    expect(html).not.toContain('Create role');
    expect(html).not.toContain('Open actions for Viewer');
  });

  it('renders an accent create role action for role managers', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(RolesPageContent, {
        state: createRolesPageState(['organization.role.read', 'organization.role.manage']),
      }),
    );

    expect(html).toContain('Create role');
    expect(html).toContain('button-accent-surface');
    expect(html).toContain('lucide-shield-plus');
    expect(html).not.toContain('Define permission sets for organization access.');
  });

  it('keeps the roles table when no roles are returned', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(RolesPageContent, {
        state: createRolesPageState(['organization.role.read', 'organization.role.manage'], { roles: [] }),
      }),
    );

    expect(html).toContain('Create role');
    expect(html).toContain('Search roles');
    expect(html).toContain('No roles found.');
    expect(html).toContain('button-accent-surface');
    expect(html).not.toContain('You do not have any roles.');
  });

  it('keeps system roles in the roles table', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(RolesPageContent, {
        state: createRolesPageState(['organization.role.read', 'organization.role.manage'], {
          roles: [{ ...createRole(), id: 'role_system_admin', kind: 'system', name: 'Admin' }],
        }),
      }),
    );

    expect(html).toContain('Admin');
    expect(html).toContain('System');
    expect(html).toContain('Create role');
    expect(html).toContain('Search roles');
    expect(html).not.toContain('You do not have any roles.');
  });

  it('renders a users back action when roles page has a valid users return target', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(RolesPageContent, {
        state: createRolesPageState(['organization.role.read'], {
          backHref: '/orgs/acme-dev/users?userEmail=viewer%40example.com',
        }),
      }),
    );

    expect(html).toContain('Back to Users');
    expect(html).toContain('href="/orgs/acme-dev/users?userEmail=viewer%40example.com"');
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('lucide-arrow-left');
  });

  it('renders a groups back action when roles page has a valid groups return target', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(RolesPageContent, {
        state: createRolesPageState(['organization.role.read'], {
          backHref: '/orgs/acme-dev/groups?groupId=group_123',
        }),
      }),
    );

    expect(html).toContain('Back to Groups');
    expect(html).toContain('href="/orgs/acme-dev/groups?groupId=group_123"');
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('lucide-arrow-left');
  });
});

function createUsersPageResult(
  currentOrganizationPermissions: PermissionKey[],
  overrides: Partial<BrowserUsersPageResult> = {},
): BrowserUsersPageResult {
  return {
    availableGroups: [],
    availableRoles: [],
    currentOrganizationPermissions,
    mode: 'list',
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [createOrganizationOption()],
    page: 1,
    pageSize: 10,
    pageSizeOptions: [10, 20, 50],
    principalEmail: 'admin@example.com',
    projectCount: 1,
    searchQuery: '',
    selectedOrganizationSlug: 'acme-dev',
    selectedUserAccess: null,
    selectedUserEmail: null,
    showOrganizationSelector: false,
    scopeProjects: [],
    sortBy: 'email',
    sortDirection: 'asc',
    totalPages: 1,
    totalUsers: 1,
    users: [createUser()],
    ...overrides,
  };
}

function createUser(): BrowserUsersUser {
  return {
    access: 'allowed',
    accessSummary: 'Limited view',
    directAccessScopeLabels: [],
    email: 'viewer@example.com',
    groupCount: 0,
    groupNames: [],
    id: 'usr_123',
    roleNames: ['viewer'],
    status: 'active',
    type: 'user',
  };
}

function createCurrentPrincipalUser(): BrowserUsersUser {
  return {
    ...createUser(),
    email: 'admin@example.com',
    id: 'usr_admin',
  };
}

function createGroupsPageState(
  currentOrganizationPermissions: PermissionKey[],
  groups: AccessGroupListRow[] = [],
): GroupsPageState {
  const data: BrowserGroupsPageResult = {
    assignments: [],
    currentOrganizationPermissions,
    groups,
    members: [],
    mode: 'list',
    noticeMessage: undefined,
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [createOrganizationOption()],
    principalEmail: 'admin@example.com',
    projectCount: 1,
    roles: [],
    scopeProjects: [],
    selectedGroupId: null,
    selectedOrganizationSlug: 'acme-dev',
    showOrganizationSelector: false,
  };

  return {
    data,
    drawerErrorMessage: undefined,
    environmentValues: [],
    groupAssignments: [],
    groupDescription: '',
    groupName: '',
    memberEmail: '',
    newGroupDescription: '',
    newGroupName: '',
    onNavigate: vi.fn<BrowserSoftNavigateHandler>(),
    projectNames: [],
    roleId: '',
    scopeType: 'organization',
    selectedGroup: undefined,
    setData: vi.fn(),
    setDrawerErrorMessage: vi.fn(),
    setEnvironmentValues: vi.fn(),
    setGroupDescription: vi.fn(),
    setGroupName: vi.fn(),
    setMemberEmail: vi.fn(),
    setNewGroupDescription: vi.fn(),
    setNewGroupName: vi.fn(),
    setProjectNames: vi.fn(),
    setRoleId: vi.fn(),
    setScopeType: vi.fn(),
  };
}

function createGroupDetailPageState(currentOrganizationPermissions: PermissionKey[]): GroupsPageState {
  const state: GroupsPageState = createGroupsPageState(currentOrganizationPermissions);
  const group: AccessGroupListRow = createGroup();
  state.data = {
    ...state.data,
    groups: [group],
    mode: 'detail',
    selectedGroupId: group.id,
  };
  state.selectedGroup = group;
  return state;
}

function createGroup(): AccessGroupListRow {
  return {
    assignedRoleNames: ['Viewer'],
    assignmentCount: 2,
    assignmentScopeLabels: ['2 scopes'],
    description: null,
    id: 'group_123',
    memberCount: 1,
    name: 'Operators',
  };
}

function createRolesPageState(
  currentOrganizationPermissions: PermissionKey[],
  overrides: Partial<BrowserRolesPageResult> = {},
): RolesPageState {
  return {
    data: createRolesPageResult(currentOrganizationPermissions, overrides),
    description: '',
    drawerErrorMessage: undefined,
    name: '',
    onNavigate: vi.fn<BrowserSoftNavigateHandler>(),
    selectedPermissions: [],
    setData: vi.fn(),
    setDescription: vi.fn(),
    setDrawerErrorMessage: vi.fn(),
    setName: vi.fn(),
    setSelectedPermissions: vi.fn(),
  };
}

function createRolesPageResult(
  currentOrganizationPermissions: PermissionKey[],
  overrides: Partial<BrowserRolesPageResult> = {},
): BrowserRolesPageResult {
  return {
    currentOrganizationPermissions,
    mode: 'list',
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [createOrganizationOption()],
    permissionKeys: ['project.read'],
    principalEmail: 'admin@example.com',
    projectCount: 1,
    role: null,
    roleId: null,
    roles: [createRole()],
    selectedOrganizationSlug: 'acme-dev',
    showOrganizationSelector: false,
    ...overrides,
  };
}

function createRole(): AccessRoleListRow {
  return {
    assignmentCount: 0,
    description: null,
    groupCount: 0,
    id: 'role_123',
    kind: 'custom',
    name: 'Viewer',
    permissionKeys: ['project.read'],
    principalCount: 0,
  };
}

function createOrganizationOption(): BrowserOrganizationOption {
  return {
    id: 'org_123',
    name: 'Acme Dev',
    slug: 'acme-dev',
  };
}
