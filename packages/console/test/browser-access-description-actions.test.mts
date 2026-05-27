import type {
  AccessGroupListRow,
  AccessGroupResponse,
  AccessRoleListRow,
  AccessRoleResponse,
  CreateAccessGroupRequest,
  CreateAccessRoleRequest,
  PermissionKey,
  UpdateAccessGroupRequest,
  UpdateAccessRoleRequest,
} from '@compartment/contracts/browser';
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest';
import { type BrowserFetchCall, type FetchImplementation, readFetchPath } from './browser-client-pages.helpers';
import { browserQueryClient } from '../src/lib/browser-query-client';
import { handleGroupCreateAction, handleGroupRenameAction } from '../src/features/groups/groups-page.actions';
import { handleRoleSubmit } from '../src/features/roles/roles-page.actions';
import type { BrowserGroupsPageResult } from '../src/services/browser-groups.service.types';
import type { BrowserOrganizationOption } from '../src/services/browser-organization.service.types';
import type { BrowserRolesPageResult } from '../src/services/browser-roles.service.types';

type AccessMutationRequest =
  | CreateAccessGroupRequest
  | CreateAccessRoleRequest
  | UpdateAccessGroupRequest
  | UpdateAccessRoleRequest;

afterEach((): void => {
  browserQueryClient.clear();
  vi.unstubAllGlobals();
});

describe('browser access description actions', (): void => {
  it('sends null when creating a group without a description', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>(async (): Promise<Response> => {
      await Promise.resolve();
      return createJsonResponse(createGroupResponse());
    });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    await expect(handleGroupCreateAction(createGroupsPageResult(), '   ', 'Operators')).resolves.toEqual(
      createGroupResponse(),
    );

    expect(readRequestJson(fetchMock.mock.calls[0]!)).toEqual({
      description: null,
      name: 'Operators',
    });
    expect(readFetchPath(fetchMock.mock.calls[0]![0])).toBe('/v1/groups');
  });

  it('sends null when updating a group without a description', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>(async (): Promise<Response> => {
      await Promise.resolve();
      return createJsonResponse(createGroupResponse());
    });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      handleGroupRenameAction(
        createGroupsPageResult(),
        'group_123',
        '',
        'Operators',
        (): void => undefined,
        (): void => undefined,
      ),
    ).resolves.toBe(true);

    expect(readRequestJson(fetchMock.mock.calls[0]!)).toEqual({
      description: null,
      name: 'Operators',
    });
    expect(readFetchPath(fetchMock.mock.calls[0]![0])).toBe('/v1/groups/group_123');
  });

  it('updates an off-page selected group summary after a successful rename', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>(async (): Promise<Response> => {
      await Promise.resolve();
      return createJsonResponse(createGroupResponse());
    });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const selectedGroup: AccessGroupListRow = {
      assignedRoleNames: ['Viewer'],
      assignmentCount: 1,
      assignmentScopeLabels: ['Organization'],
      description: 'Before',
      id: 'group_123',
      memberCount: 2,
      name: 'Operators',
    };
    const initialState: BrowserGroupsPageResult = createGroupsPageResult({
      groups: [],
      mode: 'detail',
      selectedGroup,
      selectedGroupId: selectedGroup.id,
    });
    let nextState: BrowserGroupsPageResult | undefined;

    await expect(
      handleGroupRenameAction(
        initialState,
        selectedGroup.id,
        'After',
        'Operators Plus',
        (value: BrowserGroupsPageResult | ((current: BrowserGroupsPageResult) => BrowserGroupsPageResult)): void => {
          nextState = typeof value === 'function' ? value(initialState) : value;
        },
        (): void => undefined,
      ),
    ).resolves.toBe(true);

    expect(nextState).toBeDefined();
    if (nextState === undefined) {
      throw new Error('Expected the group rename action to update local page state.');
    }
    const updatedState: BrowserGroupsPageResult = nextState;

    expect(updatedState.selectedGroup).toMatchObject({
      description: 'After',
      name: 'Operators Plus',
    });
  });

  it('sends null when creating a role without a description', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>(async (): Promise<Response> => {
      await Promise.resolve();
      return createJsonResponse(createRoleResponse());
    });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      handleRoleSubmit(
        createRolesPageResult(),
        null,
        ' ',
        'Viewer',
        ['project.read'],
        (): void => undefined,
        (): void => undefined,
      ),
    ).resolves.toBe(true);

    expect(readRequestJson(fetchMock.mock.calls[0]!)).toEqual({
      description: null,
      name: 'Viewer',
      permissionKeys: ['project.read'],
    });
    expect(readFetchPath(fetchMock.mock.calls[0]![0])).toBe('/v1/roles');
  });
});

function createJsonResponse(body: AccessGroupResponse | AccessRoleResponse): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  });
}

function readRequestJson(call: BrowserFetchCall): AccessMutationRequest {
  if (typeof call[1]?.body !== 'string') {
    throw new Error('Expected string request body.');
  }

  return JSON.parse(call[1].body) as AccessMutationRequest;
}

function createGroupsPageResult(overrides: Partial<BrowserGroupsPageResult> = {}): BrowserGroupsPageResult {
  const groups: AccessGroupListRow[] = overrides.groups ?? [];
  return {
    assignments: [],
    currentOrganizationPermissions: ['organization.group.manage'],
    groups,
    members: [],
    mode: 'list',
    noticeMessage: undefined,
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [createOrganizationOption()],
    page: 1,
    pageSize: 10,
    pageSizeOptions: [10, 20, 50],
    principalEmail: 'admin@example.com',
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

function createRolesPageResult(overrides: Partial<BrowserRolesPageResult> = {}): BrowserRolesPageResult {
  const roles: AccessRoleListRow[] = overrides.roles ?? [];
  return {
    currentOrganizationPermissions: ['organization.role.manage'],
    mode: 'list',
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [createOrganizationOption()],
    page: 1,
    pageSize: 10,
    pageSizeOptions: [10, 20, 50],
    permissionKeys: ['project.read'],
    principalEmail: 'admin@example.com',
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

function createGroupResponse(): AccessGroupResponse {
  return {
    group: {
      assignmentCount: 0,
      description: null,
      id: 'group_123',
      memberCount: 0,
      name: 'Operators',
    },
  };
}

function createRoleResponse(permissionKeys: PermissionKey[] = ['project.read']): AccessRoleResponse {
  return {
    role: {
      description: null,
      id: 'role_123',
      kind: 'custom',
      name: 'Viewer',
      permissionKeys,
    },
  };
}

function createOrganizationOption(): BrowserOrganizationOption {
  return {
    id: 'org_123',
    name: 'Acme Dev',
    slug: 'acme-dev',
  };
}
