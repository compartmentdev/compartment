import { QueryObserver } from '@tanstack/react-query';
import {
  type AccessGroupListRow,
  type AccessGroupMemberSummary,
  type AccessGroupResponse,
  type AccessRoleListRow,
  type AccessRoleResponse,
  type PermissionKey,
} from '@compartment/contracts/browser';
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest';
import { createJsonResponse } from './browser-test.fixtures';
import { type FetchImplementation, readFetchPath } from './browser-client-pages.helpers';
import { readAccessGroupsMembersQueryKey, readAccessRolesDetailQueryKey } from '../src/features/access/access-query';
import { handleGroupDeleteAction } from '../src/features/groups/groups-page.actions';
import { loadSelectedGroupMembers } from '../src/features/groups/groups-loader.requests';
import { handleRoleDelete } from '../src/features/roles/roles-page.actions';
import { readSelectedRole } from '../src/features/roles/roles-loader';
import { browserQueryClient, type BrowserQueryFunctionContext } from '../src/lib/browser-query-client';
import type { BrowserGroupsPageResult } from '../src/services/browser-groups.service.types';
import type { BrowserRolesPageResult } from '../src/services/browser-roles.service.types';

type SelectedRoleResponse = AccessRoleResponse | null;

afterEach((): void => {
  browserQueryClient.clear();
  vi.unstubAllGlobals();
});

describe('browser access delete refresh', (): void => {
  it('keeps group delete successful when the active members query refetches a deleted group', async (): Promise<void> => {
    let membersReadCount: number = 0;
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>(
      async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const path: string = readFetchPath(input);
        const method: string = init?.method ?? 'GET';

        if (path === '/v1/groups/group_123/members') {
          membersReadCount += 1;
          return await Promise.resolve(
            membersReadCount === 1
              ? createJsonResponse({ members: [] })
              : createJsonResponse({ message: 'The requested access group was not found.' }, 404),
          );
        }
        if (path === '/v1/groups/group_123' && method === 'DELETE') {
          return await Promise.resolve(createJsonResponse(createGroupResponse()));
        }

        return await Promise.reject(new Error(`Unexpected fetch request: ${method} ${path}`));
      },
    );

    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const observer: QueryObserver<AccessGroupMemberSummary[]> = new QueryObserver<AccessGroupMemberSummary[]>(
      browserQueryClient,
      {
        queryFn: async ({ signal }: BrowserQueryFunctionContext): Promise<AccessGroupMemberSummary[]> =>
          await loadSelectedGroupMembers('acme-dev', 'group_123', { signal }),
        queryKey: readAccessGroupsMembersQueryKey('acme-dev', 'group_123'),
        retry: false,
      },
    );
    const unsubscribe: () => void = observer.subscribe((): void => undefined);
    await observer.refetch();

    await expect(
      handleGroupDeleteAction(
        createGroupsPageResult({
          selectedGroup: createGroupListRow('group_123', 'Operators'),
          selectedGroupId: 'group_123',
        }),
        'group_123',
        (): void => undefined,
        (): void => undefined,
      ),
    ).resolves.toBe(true);

    expect(membersReadCount).toBe(2);
    expect(observer.getCurrentResult().data).toEqual([]);
    unsubscribe();
  });

  it('keeps role delete successful when the active detail query refetches a deleted role', async (): Promise<void> => {
    let roleReadCount: number = 0;
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>(
      async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const path: string = readFetchPath(input);
        const method: string = init?.method ?? 'GET';

        if (path === '/v1/roles/role_123' && method === 'GET') {
          roleReadCount += 1;
          return await Promise.resolve(
            roleReadCount === 1
              ? createJsonResponse(createRoleResponse())
              : createJsonResponse({ message: 'The requested role was not found.' }, 404),
          );
        }
        if (path === '/v1/roles/role_123' && method === 'DELETE') {
          return await Promise.resolve(createJsonResponse(createRoleResponse()));
        }

        return await Promise.reject(new Error(`Unexpected fetch request: ${method} ${path}`));
      },
    );

    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const observer: QueryObserver<SelectedRoleResponse> = new QueryObserver<SelectedRoleResponse>(browserQueryClient, {
      queryFn: async ({ signal }: BrowserQueryFunctionContext): Promise<SelectedRoleResponse> =>
        await readSelectedRole('acme-dev', 'role_123', { signal }),
      queryKey: readAccessRolesDetailQueryKey('acme-dev', 'role_123'),
      retry: false,
    });
    const unsubscribe: () => void = observer.subscribe((): void => undefined);
    await observer.refetch();

    await expect(
      handleRoleDelete(
        createRoleListRow('role_123', 'Viewer'),
        createRolesPageResult({
          role: createRoleResponse().role,
          roleId: 'role_123',
        }),
        (): void => undefined,
      ),
    ).resolves.toBe(true);

    expect(roleReadCount).toBe(2);
    expect(observer.getCurrentResult().data).toBeNull();
    unsubscribe();
  });
});

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
    scopeProjects: [],
    searchQuery: '',
    selectedGroup: null,
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

function createRoleResponse(): AccessRoleResponse {
  return {
    role: {
      description: null,
      id: 'role_123',
      kind: 'custom',
      name: 'Viewer',
      permissionKeys: ['project.read'],
    },
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
