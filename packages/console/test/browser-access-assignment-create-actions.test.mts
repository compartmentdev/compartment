import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PermissionKey } from '@compartment/contracts/browser';
import type { BrowserGroupsPageResult } from '../src/services/browser-groups.service.types';
import type { BrowserOrganizationOption } from '../src/services/browser-organization.service.types';
import type { BrowserUsersPageResult, BrowserUsersUser } from '../src/services/browser-users.service.types';
import { requestBrowserApi } from '../src/lib/browser-api';
import { invalidateGroupsAccessQueries } from '../src/features/groups/groups-query-invalidate';
import { handleGroupAssignmentCreateAction } from '../src/features/groups/groups-page.actions';
import { handleUserAccessAssignmentCreate } from '../src/features/users/user-access-panel.actions';
import { invalidateUserAccessQueries } from '../src/features/users/users-query-invalidation';

type StringArraySetter = (value: string[]) => void;
type ErrorSetter = (value: string | undefined) => void;

vi.mock('../src/lib/browser-api', (): { requestBrowserApi: typeof requestBrowserApi } => ({
  requestBrowserApi: vi.fn(),
}));

vi.mock(
  '../src/features/groups/groups-query-invalidate',
  (): { invalidateGroupsAccessQueries: typeof invalidateGroupsAccessQueries } => ({
    invalidateGroupsAccessQueries: vi.fn(),
  }),
);

vi.mock(
  '../src/features/users/users-query-invalidation',
  (): { invalidateUserAccessQueries: typeof invalidateUserAccessQueries } => ({
    invalidateUserAccessQueries: vi.fn(),
  }),
);

beforeEach((): void => {
  vi.clearAllMocks();
  vi.mocked(requestBrowserApi).mockImplementation(async (): Promise<void> => await Promise.resolve());
  vi.mocked(invalidateGroupsAccessQueries).mockResolvedValue(undefined);
  vi.mocked(invalidateUserAccessQueries).mockResolvedValue(undefined);
});

describe('access assignment create actions', (): void => {
  it('clears group scope selections after a successful assignment create', async (): Promise<void> => {
    const data: BrowserGroupsPageResult = createGroupsPageResult();
    const setEnvironmentValues: StringArraySetter = vi.fn();
    const setProjectNames: StringArraySetter = vi.fn();
    const setErrorMessage: ErrorSetter = vi.fn();

    await handleGroupAssignmentCreateAction(
      data,
      'group_123',
      'role_123',
      'environment',
      ['billing'],
      ['billing::production'],
      vi.fn(),
      setErrorMessage,
      setEnvironmentValues,
      setProjectNames,
    );

    expect(requestBrowserApi).toHaveBeenCalledTimes(1);
    expect(invalidateGroupsAccessQueries).toHaveBeenCalledWith(data);
    expect(setErrorMessage).toHaveBeenNthCalledWith(1, undefined);
    expect(setEnvironmentValues).toHaveBeenCalledWith([]);
    expect(setProjectNames).toHaveBeenCalledWith([]);
  });

  it('keeps group scope selections when assignment create fails', async (): Promise<void> => {
    vi.mocked(requestBrowserApi).mockRejectedValueOnce(new Error('Group create failed.'));

    const data: BrowserGroupsPageResult = createGroupsPageResult();
    const setEnvironmentValues: StringArraySetter = vi.fn();
    const setProjectNames: StringArraySetter = vi.fn();
    const setErrorMessage: ErrorSetter = vi.fn();

    await handleGroupAssignmentCreateAction(
      data,
      'group_123',
      'role_123',
      'environment',
      ['billing'],
      ['billing::production'],
      vi.fn(),
      setErrorMessage,
      setEnvironmentValues,
      setProjectNames,
    );

    expect(invalidateGroupsAccessQueries).not.toHaveBeenCalled();
    expect(setErrorMessage).toHaveBeenLastCalledWith('Group create failed.');
    expect(setEnvironmentValues).not.toHaveBeenCalledWith([]);
    expect(setProjectNames).not.toHaveBeenCalledWith([]);
  });

  it('clears user scope selections after a successful assignment create', async (): Promise<void> => {
    const data: BrowserUsersPageResult = createUsersPageResult();
    const setEnvironmentValues: StringArraySetter = vi.fn();
    const setProjectNames: StringArraySetter = vi.fn();
    const setErrorMessage: ErrorSetter = vi.fn();

    await handleUserAccessAssignmentCreate(
      data,
      'viewer@example.com',
      'role_123',
      'project',
      ['billing'],
      [],
      vi.fn(),
      setErrorMessage,
      setEnvironmentValues,
      setProjectNames,
    );

    expect(requestBrowserApi).toHaveBeenCalledTimes(1);
    expect(invalidateUserAccessQueries).toHaveBeenCalledWith(data);
    expect(setErrorMessage).toHaveBeenNthCalledWith(1, undefined);
    expect(setEnvironmentValues).toHaveBeenCalledWith([]);
    expect(setProjectNames).toHaveBeenCalledWith([]);
  });

  it('keeps user scope selections when assignment create fails', async (): Promise<void> => {
    vi.mocked(requestBrowserApi).mockRejectedValueOnce(new Error('User create failed.'));

    const data: BrowserUsersPageResult = createUsersPageResult();
    const setEnvironmentValues: StringArraySetter = vi.fn();
    const setProjectNames: StringArraySetter = vi.fn();
    const setErrorMessage: ErrorSetter = vi.fn();

    await handleUserAccessAssignmentCreate(
      data,
      'viewer@example.com',
      'role_123',
      'project',
      ['billing'],
      [],
      vi.fn(),
      setErrorMessage,
      setEnvironmentValues,
      setProjectNames,
    );

    expect(invalidateUserAccessQueries).not.toHaveBeenCalled();
    expect(setErrorMessage).toHaveBeenLastCalledWith('User create failed.');
    expect(setEnvironmentValues).not.toHaveBeenCalledWith([]);
    expect(setProjectNames).not.toHaveBeenCalledWith([]);
  });
});

function createGroupsPageResult(): BrowserGroupsPageResult {
  return {
    assignments: [],
    currentOrganizationPermissions: createAccessManagerPermissions(),
    groups: [],
    members: [],
    mode: 'detail',
    noticeMessage: undefined,
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [createOrganizationOption()],
    page: 1,
    pageSize: 10,
    pageSizeOptions: [10, 20, 50],
    principalEmail: 'admin@example.com',
    roles: [],
    searchQuery: '',
    scopeProjects: [{ environmentNames: ['production'], projectName: 'billing' }],
    selectedGroupId: 'group_123',
    selectedOrganizationSlug: 'acme-dev',
    showOrganizationSelector: false,
    sortBy: 'name',
    sortDirection: 'asc',
    totalGroups: 0,
    totalPages: 1,
  };
}

function createUsersPageResult(): BrowserUsersPageResult {
  return {
    availableGroups: [],
    availableRoles: [],
    currentOrganizationPermissions: createAccessManagerPermissions(),
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
    selectedUserAccess: {
      directAssignments: [],
      effectivePermissions: ['project.read'],
      groups: [],
      user: createUser(),
    },
    selectedUserEmail: 'viewer@example.com',
    showOrganizationSelector: false,
    scopeProjects: [{ environmentNames: ['production'], projectName: 'billing' }],
    sortBy: 'email',
    sortDirection: 'asc',
    totalPages: 1,
    totalUsers: 1,
    users: [createUser()],
  };
}

function createAccessManagerPermissions(): PermissionKey[] {
  return ['organization.group.manage', 'organization.role.manage', 'organization.user.read'];
}

function createOrganizationOption(): BrowserOrganizationOption {
  return {
    id: 'org_123',
    name: 'Acme Dev',
    slug: 'acme-dev',
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
    roleNames: ['Viewer'],
    status: 'active',
    type: 'user',
  };
}
