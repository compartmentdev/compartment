import * as React from 'react';
import type {
  AccessGroupListRow,
  AccessRoleListRow,
  PermissionKey,
  UserAccessDetail,
} from '@compartment/contracts/browser';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserSoftNavigateHandler } from '../src/browser-soft-navigation';
import { AccessScopeInputs } from '../src/features/access/access-scope-inputs';
import type { BrowserGroupsPageResult } from '../src/services/browser-groups.service.types';
import type { BrowserOrganizationOption } from '../src/services/browser-organization.service.types';
import type { BrowserRolesPageResult } from '../src/services/browser-roles.service.types';
import type { BrowserUsersPageResult, BrowserUsersUser } from '../src/services/browser-users.service.types';
import { GroupsPageContent } from '../src/features/groups/groups-page.sections';
import type { GroupsPageState } from '../src/features/groups/groups-page.state';
import { RolesPageContent } from '../src/features/roles/roles-page.sections';
import type { RolesPageState } from '../src/features/roles/roles-page.state';
import { UserAccessPanel } from '../src/features/users/user-access-panel';

afterEach((): void => {
  vi.unstubAllGlobals();
});

describe('browser access detail drawers', (): void => {
  it('renders user detail without removed summary metric tiles', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(UserAccessPanel, {
        data: createUsersPageResult(['organization.user.read']),
        onNavigate: vi.fn<BrowserSoftNavigateHandler>(),
        setData: vi.fn(),
      }),
    );

    expect(html).toContain('Groups');
    expect(html).toContain('Direct assignments');
    expect(html).toContain('data:image/svg+xml;utf8,');
    expect(html).toMatch(
      /<button(?=[^>]*aria-expanded="true")[^>]*>(?:(?!<\/button>).)*Effective permissions(?:(?!<\/button>).)*<\/button>/s,
    );
    expect(html).not.toContain('Inherited access');
    expect(html).not.toContain('Manual access');
    expect(html).not.toContain('Effective total');
  });

  it('renders role detail without removed summary metric tiles', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(RolesPageContent, {
        state: createRolesPageState(['organization.role.read']),
      }),
    );

    expect(html).toContain('Effective permissions');
    expect(html).not.toContain('selected permissions');
    expect(html).not.toContain('>groups<');
    expect(html).not.toContain('direct members');
  });

  it('renders role-readable group detail without removed summary metric tiles', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(GroupsPageContent, {
        state: createGroupDetailPageState(['organization.group.read', 'organization.role.read']),
      }),
    );

    expect(html).toContain('Assignments');
    expect(html).toContain('Effective permissions');
    expect(html).not.toContain('>users<');
    expect(html).not.toContain('>projects<');
  });

  it('renders environment assignment inputs as a project to environment dependency chain', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(AccessScopeInputs, {
        environmentValues: [],
        projectNames: [],
        scopeProjects: [{ environmentNames: ['production', 'staging'], projectName: 'ng2-admin' }],
        scopeType: 'environment',
        setEnvironmentValues: vi.fn(),
        setProjectNames: vi.fn(),
      }),
    );

    expect(html).toContain('Project(s)');
    expect(html).toContain('Environment(s)');
    expect(html).toContain('aria-labelledby="');
    expect(html).toContain('disabled=""');
    expect(html).toContain('Select project(s) first');
  });
});

function createUsersPageResult(currentOrganizationPermissions: PermissionKey[]): BrowserUsersPageResult {
  const user: BrowserUsersUser = createUser();
  const group: AccessGroupListRow = createGroup();
  const access: UserAccessDetail = {
    directAssignments: [],
    effectivePermissions: ['project.read'],
    groups: [
      {
        assignmentCount: group.assignmentCount,
        description: group.description,
        id: group.id,
        memberCount: group.memberCount,
        name: group.name,
      },
    ],
    user,
  };

  return {
    availableGroups: [group],
    availableRoles: [],
    currentOrganizationPermissions,
    mode: 'detail',
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [createOrganizationOption()],
    page: 1,
    pageSize: 10,
    pageSizeOptions: [10, 20, 50],
    principalEmail: 'admin@example.com',
    projectCount: 1,
    searchQuery: '',
    selectedOrganizationSlug: 'acme-dev',
    selectedUserAccess: access,
    selectedUserEmail: user.email,
    showOrganizationSelector: false,
    scopeProjects: [],
    sortBy: 'email',
    sortDirection: 'asc',
    totalPages: 1,
    totalUsers: 1,
    users: [user],
  };
}

function createUser(): BrowserUsersUser {
  return {
    access: 'allowed',
    accessSummary: 'Limited view',
    directAccessScopeLabels: [],
    email: 'viewer@example.com',
    groupCount: 1,
    groupNames: ['Operators'],
    id: 'usr_123',
    roleNames: ['viewer'],
    status: 'active',
    type: 'user',
  };
}

function createGroupDetailPageState(currentOrganizationPermissions: PermissionKey[]): GroupsPageState {
  const group: AccessGroupListRow = createGroup();
  const data: BrowserGroupsPageResult = {
    assignments: [
      {
        createdAt: '2025-01-01T00:00:00.000Z',
        id: 'asg_123',
        roleId: 'role_123',
        roleKind: 'custom',
        roleName: 'Viewer',
        scope: { projectName: 'billing', scopeType: 'project' },
        subject: {
          groupId: group.id,
          groupName: group.name,
          subjectType: 'group',
        },
      },
    ],
    currentOrganizationPermissions,
    groups: [group],
    members: [],
    mode: 'detail',
    noticeMessage: undefined,
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [createOrganizationOption()],
    page: 1,
    pageSize: 10,
    pageSizeOptions: [10, 20, 50],
    principalEmail: 'admin@example.com',
    roles: [createRole()],
    searchQuery: '',
    scopeProjects: [],
    selectedGroupId: group.id,
    selectedOrganizationSlug: 'acme-dev',
    showOrganizationSelector: false,
    sortBy: 'name',
    sortDirection: 'asc',
    totalGroups: 1,
    totalPages: 1,
  };

  return {
    data,
    drawerErrorMessage: undefined,
    environmentValues: [],
    groupAssignments: data.assignments,
    groupDescription: group.description ?? '',
    groupName: group.name,
    memberEmail: '',
    newGroupDescription: '',
    newGroupName: '',
    onNavigate: vi.fn<BrowserSoftNavigateHandler>(),
    projectNames: [],
    roleId: '',
    scopeType: 'organization',
    selectedGroup: group,
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

function createRolesPageState(currentOrganizationPermissions: PermissionKey[]): RolesPageState {
  const role: AccessRoleListRow = createRole();
  const data: BrowserRolesPageResult = {
    currentOrganizationPermissions,
    mode: 'detail',
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [createOrganizationOption()],
    page: 1,
    pageSize: 10,
    pageSizeOptions: [10, 20, 50],
    permissionKeys: role.permissionKeys,
    principalEmail: 'admin@example.com',
    role,
    roleId: role.id,
    roles: [role],
    searchQuery: '',
    selectedOrganizationSlug: 'acme-dev',
    showOrganizationSelector: false,
    sortBy: 'name',
    sortDirection: 'asc',
    totalPages: 1,
    totalRoles: 1,
  };

  return {
    data,
    description: role.description ?? '',
    drawerErrorMessage: undefined,
    name: role.name,
    onNavigate: vi.fn<BrowserSoftNavigateHandler>(),
    selectedPermissions: role.permissionKeys,
    setData: vi.fn(),
    setDescription: vi.fn(),
    setDrawerErrorMessage: vi.fn(),
    setName: vi.fn(),
    setSelectedPermissions: vi.fn(),
  };
}

function createRole(): AccessRoleListRow {
  return {
    assignmentCount: 1,
    description: 'Read-only role',
    groupCount: 1,
    id: 'role_123',
    kind: 'custom',
    name: 'Viewer',
    permissionKeys: ['project.read'],
    principalCount: 1,
  };
}

function createGroup(): AccessGroupListRow {
  return {
    assignedRoleNames: ['Viewer'],
    assignmentCount: 1,
    assignmentScopeLabels: ['Project billing'],
    description: 'Operators who handle incidents',
    id: 'group_123',
    memberCount: 1,
    name: 'Operators',
  };
}

function createOrganizationOption(): BrowserOrganizationOption {
  return {
    id: 'org_123',
    name: 'Acme Dev',
    slug: 'acme-dev',
  };
}
