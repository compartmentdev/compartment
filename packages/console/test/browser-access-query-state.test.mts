import * as React from 'react';
import { QueryClientProvider, type QueryKey } from '@tanstack/react-query';
import {
  type AccessGroupListRow,
  compartmentCurrentOrganizationHeaderName,
  type AccessRoleListResponse,
  type AccessRoleListRow,
  type AccessRoleResponse,
  type PermissionKey,
  type UserListResponse,
} from '@compartment/contracts/browser';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest';
import { createJsonResponse, waitForNextTick } from './browser-test.fixtures';
import { type BrowserFetchCall, type FetchImplementation, readFetchPath } from './browser-client-pages.helpers';
import { browserQueryClient } from '../src/lib/browser-query-client';
import type { BrowserGroupsPageResult } from '../src/services/browser-groups.service.types';
import type { BrowserRolesPageResult } from '../src/services/browser-roles.service.types';
import type { BrowserUsersPageResult, BrowserUsersUser } from '../src/services/browser-users.service.types';
import {
  readAccessGroupsListQueryKey,
  readAccessGroupsOrganizationQueryKey,
  readAccessRolesListQueryKey,
  readAccessRolesOrganizationQueryKey,
  readAccessUsersListQueryKey,
  readAccessUsersOrganizationQueryKey,
} from '../src/features/access/access-query';
import { readBrowserConsoleWhoAmIQueryKey } from '../src/features/console/console-query';
import { readGroupDeleteConfirmationMessage } from '../src/features/groups/groups-page.actions';
import { handleRoleDelete, readRoleDeleteConfirmationMessage } from '../src/features/roles/roles-page.actions';
import { useGroupsPageQueryData } from '../src/features/groups/groups-query-state';
import { useRolesPageQueryData } from '../src/features/roles/roles-query-state';
import { useUsersPageQueryData } from '../src/features/users/users-query-state';
import type { GroupsPageState } from '../src/features/groups/groups-page.state';
import type { RolesPageState } from '../src/features/roles/roles-page.state';
import type * as GroupDetailDrawerModule from '../src/features/groups/groups-page.detail-drawer';
import type * as RoleDetailDrawerModule from '../src/features/roles/roles-page.detail-drawer';
import type * as RolesTableModule from '../src/features/roles/roles-page.table';

interface CapturedButtonProps {
  children: React.ReactNode;
  onClick?: (() => void) | undefined;
}

interface CapturedDropdownMenuItemProps {
  children: React.ReactNode;
  onSelect?: (() => void) | undefined;
}

afterEach((): void => {
  browserQueryClient.clear();
  vi.doUnmock('../src/components/ui/button');
  vi.doUnmock('../src/components/ui/dropdown-menu');
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
    browserQueryClient.setQueryData(readAccessGroupsListQueryKey('beta-dev'), {
      groups: [createGroupListRow('group_beta', 'Beta group')],
    });
    browserQueryClient.setQueryData(readAccessGroupsListQueryKey('acme-dev'), {
      groups: [createGroupListRow('group_acme', 'Acme group')],
    });

    const markup: string = renderWithBrowserQueryClient(
      React.createElement(GroupsQueryProbe, {
        data: createGroupsPageResult({ groups: [createGroupListRow('group_loader', 'Loader group')] }),
      }),
    );

    expect(markup).toContain('Acme group');
    expect(markup).not.toContain('Beta group');
    expect(markup).not.toContain('Loader group');
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
    browserQueryClient.setQueryData(readAccessRolesListQueryKey('beta-dev'), {
      roles: [createRoleListRow('role_beta', 'Beta role')],
    });
    browserQueryClient.setQueryData(readAccessRolesListQueryKey('acme-dev'), {
      roles: [createRoleListRow('role_acme', 'Acme role')],
    });

    const markup: string = renderWithBrowserQueryClient(
      React.createElement(RolesQueryProbe, {
        data: createRolesPageResult({ roles: [createRoleListRow('role_loader', 'Loader role')] }),
      }),
    );

    expect(markup).toContain('Acme role');
    expect(markup).not.toContain('Beta role');
    expect(markup).not.toContain('Loader role');
  });

  it('invalidates role mutations inside the selected organization only', async (): Promise<void> => {
    const acmeRolesListKey: QueryKey = readAccessRolesListQueryKey('acme-dev');
    const betaRolesListKey: QueryKey = readAccessRolesListQueryKey('beta-dev');
    browserQueryClient.setQueryData(acmeRolesListKey, createRoleListResponse('role_acme', 'Acme role'));
    browserQueryClient.setQueryData(betaRolesListKey, createRoleListResponse('role_beta', 'Beta role'));
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

  it('requires typed confirmation before role delete mutation runs from the detail drawer', async (): Promise<void> => {
    const capturedButtons: CapturedButtonProps[] = [];
    vi.doMock('../src/components/ui/button', (): { Button: (props: CapturedButtonProps) => React.ReactElement } => ({
      Button: (props: CapturedButtonProps): React.ReactElement => {
        capturedButtons.push(props);
        return React.createElement('button', null, props.children);
      },
    }));
    const roleDetailDrawerModule: typeof RoleDetailDrawerModule =
      await import('../src/features/roles/roles-page.detail-drawer');
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>(async (): Promise<Response> => {
      await Promise.resolve();
      return createJsonResponse(createRoleResponse('role_123', 'Viewer'));
    });
    const promptMock: Mock<(message: string) => string> = vi
      .fn<(message: string) => string>()
      .mockReturnValueOnce('not-viewer')
      .mockReturnValueOnce('Viewer');
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { prompt: promptMock });

    renderWithBrowserQueryClient(
      React.createElement(roleDetailDrawerModule.RoleDetailDrawer, {
        state: createRolesPageState(),
      }),
    );
    const removeRoleButton: CapturedButtonProps = requireCapturedButton(capturedButtons, 'Remove role');
    removeRoleButton.onClick?.();
    await waitForNextTick();
    expect(fetchMock).not.toHaveBeenCalled();
    removeRoleButton.onClick?.();
    await waitForMutationFetch(fetchMock);

    const firstCall: BrowserFetchCall = fetchMock.mock.calls[0]!;
    expect(promptMock).toHaveBeenNthCalledWith(1, 'Type Viewer to remove this role.');
    expect(promptMock).toHaveBeenNthCalledWith(2, 'Type Viewer to remove this role.');
    expect(readFetchPath(firstCall[0])).toBe('/v1/roles/role_123');
    expect(new Headers(firstCall[1]?.headers).get(compartmentCurrentOrganizationHeaderName)).toBe('acme-dev');
    expect(browserQueryClient.getMutationCache().getAll()).toHaveLength(1);
    expect(browserQueryClient.getMutationCache().getAll()[0]?.options.mutationKey).toEqual([
      'console-access',
      'roles',
      'acme-dev',
      'role_123',
      'delete',
    ]);
  });

  it('runs role row deletes through the typed confirmation gate', async (): Promise<void> => {
    const capturedItems: CapturedDropdownMenuItemProps[] = [];
    vi.doMock(
      '../src/components/ui/dropdown-menu',
      (): {
        DropdownMenu: (props: { children: React.ReactNode }) => React.ReactElement;
        DropdownMenuContent: (props: { children: React.ReactNode }) => React.ReactElement;
        DropdownMenuItem: (props: CapturedDropdownMenuItemProps) => React.ReactElement;
        DropdownMenuTrigger: (props: { children: React.ReactNode }) => React.ReactElement;
      } => ({
        DropdownMenu: (props: { children: React.ReactNode }): React.ReactElement =>
          React.createElement(React.Fragment, null, props.children),
        DropdownMenuContent: (props: { children: React.ReactNode }): React.ReactElement =>
          React.createElement(React.Fragment, null, props.children),
        DropdownMenuItem: (props: CapturedDropdownMenuItemProps): React.ReactElement => {
          capturedItems.push(props);
          return React.createElement('button', null, props.children);
        },
        DropdownMenuTrigger: (props: { children: React.ReactNode }): React.ReactElement =>
          React.createElement(React.Fragment, null, props.children),
      }),
    );
    const rolesTableModule: typeof RolesTableModule = await import('../src/features/roles/roles-page.table');
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>(async (): Promise<Response> => {
      await Promise.resolve();
      return createJsonResponse(createRoleResponse('role_123', 'Viewer'));
    });
    const promptMock: Mock<(message: string) => string> = vi
      .fn<(message: string) => string>()
      .mockReturnValue('Viewer');
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { prompt: promptMock });

    renderWithBrowserQueryClient(
      React.createElement(rolesTableModule.RolesTable, {
        roles: [createRoleListRow('role_123', 'Viewer')],
        state: createRolesPageState(),
      }),
    );
    requireCapturedDropdownMenuItem(capturedItems, 'Remove').onSelect?.();
    await waitForMutationFetch(fetchMock);

    expect(promptMock).toHaveBeenCalledWith('Type Viewer to remove this role.');
    expect(readFetchPath(fetchMock.mock.calls[0]![0])).toBe('/v1/roles/role_123');
  });

  it('requires typed confirmation before group delete mutation runs from the detail drawer', async (): Promise<void> => {
    const capturedButtons: CapturedButtonProps[] = [];
    vi.doMock('../src/components/ui/button', (): { Button: (props: CapturedButtonProps) => React.ReactElement } => ({
      Button: (props: CapturedButtonProps): React.ReactElement => {
        capturedButtons.push(props);
        return React.createElement('button', null, props.children);
      },
    }));
    const groupDetailDrawerModule: typeof GroupDetailDrawerModule =
      await import('../src/features/groups/groups-page.detail-drawer');
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>(async (): Promise<Response> => {
      await Promise.resolve();
      return createJsonResponse({
        group: {
          assignedRoleNames: [],
          assignmentCount: 0,
          assignmentScopeLabels: [],
          description: null,
          id: 'group_123',
          memberCount: 0,
          name: 'Operators',
        },
      });
    });
    const promptMock: Mock<(message: string) => string> = vi
      .fn<(message: string) => string>()
      .mockReturnValueOnce('wrong')
      .mockReturnValueOnce('Operators');
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { prompt: promptMock });

    renderWithBrowserQueryClient(
      React.createElement(groupDetailDrawerModule.GroupDetailDrawer, {
        state: createGroupsPageState(),
      }),
    );
    const deleteGroupButton: CapturedButtonProps = requireCapturedButton(capturedButtons, 'Delete group');
    deleteGroupButton.onClick?.();
    await waitForNextTick();
    expect(fetchMock).not.toHaveBeenCalled();
    deleteGroupButton.onClick?.();
    await waitForMutationFetch(fetchMock);

    expect(promptMock).toHaveBeenNthCalledWith(1, 'Type Operators to delete this group.');
    expect(promptMock).toHaveBeenNthCalledWith(2, 'Type Operators to delete this group.');
    expect(readFetchPath(fetchMock.mock.calls[0]![0])).toBe('/v1/groups/group_123');
  });

  it('renders typed confirmation copy for role and group deletes', (): void => {
    expect(readRoleDeleteConfirmationMessage('Viewer')).toBe('Type Viewer to remove this role.');
    expect(readGroupDeleteConfirmationMessage('Operators')).toBe('Type Operators to delete this group.');
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

function RolesQueryProbe({ data }: Readonly<{ data: BrowserRolesPageResult }>): React.ReactElement {
  const queryData: BrowserRolesPageResult = useRolesPageQueryData(data);
  const roleNames: string = queryData.roles.map((role: AccessRoleListRow): string => role.name).join(',');
  return React.createElement('output', null, roleNames === '' ? 'empty' : roleNames);
}

function requireCapturedButton(buttons: CapturedButtonProps[], label: string): CapturedButtonProps {
  const button: CapturedButtonProps | undefined = buttons.find((item: CapturedButtonProps): boolean =>
    readReactNodeText(item.children).includes(label),
  );
  if (button === undefined) {
    throw new Error(`Expected button with label ${label}.`);
  }

  return button;
}

function requireCapturedDropdownMenuItem(
  items: CapturedDropdownMenuItemProps[],
  label: string,
): CapturedDropdownMenuItemProps {
  const item: CapturedDropdownMenuItemProps | undefined = items.find(
    (captured: CapturedDropdownMenuItemProps): boolean => readReactNodeText(captured.children).includes(label),
  );
  if (item === undefined) {
    throw new Error(`Expected dropdown item with label ${label}.`);
  }

  return item;
}

function readReactNodeText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(readReactNodeText).join('');
  }

  return '';
}

async function waitForMutationFetch(fetchMock: Mock<FetchImplementation>): Promise<void> {
  for (let index: number = 0; index < 10; index += 1) {
    if (fetchMock.mock.calls.length > 0) {
      return;
    }
    await waitForNextTick();
  }

  throw new Error('Expected mutation fetch call.');
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
  return {
    currentOrganizationPermissions: createAccessManagementPermissions(),
    mode: 'list',
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [{ id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' }],
    permissionKeys: ['project.read'],
    principalEmail: 'admin@example.com',
    role: null,
    roleId: null,
    roles: [createRoleListRow('role_loader', 'Loader role')],
    selectedOrganizationSlug: 'acme-dev',
    showOrganizationSelector: false,
    ...overrides,
  };
}

function createGroupsPageResult(overrides: Partial<BrowserGroupsPageResult> = {}): BrowserGroupsPageResult {
  return {
    assignments: [],
    currentOrganizationPermissions: createAccessManagementPermissions(),
    groups: [createGroupListRow('group_loader', 'Loader group')],
    members: [],
    mode: 'list',
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [{ id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' }],
    principalEmail: 'admin@example.com',
    roles: [],
    scopeProjects: [],
    selectedGroupId: null,
    selectedOrganizationSlug: 'acme-dev',
    showOrganizationSelector: false,
    ...overrides,
  };
}

function createRolesPageState(): RolesPageState {
  return Object.assign(new TestRolesPageState(), {
    data: createRolesPageResult({
      mode: 'detail',
      role: createRoleResponse('role_123', 'Viewer').role,
      roleId: 'role_123',
      roles: [createRoleListRow('role_123', 'Viewer')],
    }),
    description: '',
    drawerErrorMessage: undefined,
    name: '',
    onNavigate: (): void => undefined,
    selectedPermissions: [],
    setData: (): void => undefined,
    setDescription: (): void => undefined,
    setDrawerErrorMessage: (): void => undefined,
    setName: (): void => undefined,
    setSelectedPermissions: (): void => undefined,
  });
}

function createGroupsPageState(): GroupsPageState {
  return Object.assign(new TestGroupsPageState(), {
    data: createGroupsPageResult({
      groups: [createGroupListRow('group_123', 'Operators')],
      mode: 'detail',
      selectedGroupId: 'group_123',
    }),
    drawerErrorMessage: undefined,
    environmentValues: [],
    groupAssignments: [],
    groupDescription: '',
    groupName: '',
    memberEmail: '',
    newGroupDescription: '',
    newGroupName: '',
    onNavigate: (): void => undefined,
    projectNames: [],
    roleId: '',
    scopeType: 'organization',
    selectedGroup: createGroupListRow('group_123', 'Operators'),
    setData: (): void => undefined,
    setDrawerErrorMessage: (): void => undefined,
    setEnvironmentValues: (): void => undefined,
    setGroupDescription: (): void => undefined,
    setGroupName: (): void => undefined,
    setMemberEmail: (): void => undefined,
    setNewGroupDescription: (): void => undefined,
    setNewGroupName: (): void => undefined,
    setProjectNames: (): void => undefined,
    setRoleId: (): void => undefined,
    setScopeType: (): void => undefined,
  });
}

class TestRolesPageState implements RolesPageState {
  public data!: BrowserRolesPageResult;
  public description!: string;
  public drawerErrorMessage!: string | undefined;
  public name!: string;
  public onNavigate!: () => void;
  public selectedPermissions!: PermissionKey[];
  public setData!: () => void;
  public setDescription!: () => void;
  public setDrawerErrorMessage!: () => void;
  public setName!: () => void;
  public setSelectedPermissions!: () => void;
}

class TestGroupsPageState implements GroupsPageState {
  public data!: BrowserGroupsPageResult;
  public drawerErrorMessage!: string | undefined;
  public environmentValues!: string[];
  public groupAssignments!: [];
  public groupDescription!: string;
  public groupName!: string;
  public memberEmail!: string;
  public newGroupDescription!: string;
  public newGroupName!: string;
  public onNavigate!: () => void;
  public projectNames!: string[];
  public roleId!: string;
  public scopeType!: 'organization' | 'project' | 'environment';
  public selectedGroup!: AccessGroupListRow | undefined;
  public setData!: () => void;
  public setDrawerErrorMessage!: () => void;
  public setEnvironmentValues!: () => void;
  public setGroupDescription!: () => void;
  public setGroupName!: () => void;
  public setMemberEmail!: () => void;
  public setNewGroupDescription!: () => void;
  public setNewGroupName!: () => void;
  public setProjectNames!: () => void;
  public setRoleId!: () => void;
  public setScopeType!: () => void;
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

function createRoleListResponse(id: string, name: string): AccessRoleListResponse {
  return { roles: [createRoleListRow(id, name)] };
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
