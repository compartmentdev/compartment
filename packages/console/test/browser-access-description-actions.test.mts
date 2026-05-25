import type {
  AccessGroupResponse,
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
  return {
    assignments: [],
    currentOrganizationPermissions: ['organization.group.manage'],
    groups: [],
    members: [],
    mode: 'list',
    noticeMessage: undefined,
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [createOrganizationOption()],
    principalEmail: 'admin@example.com',
    roles: [],
    scopeProjects: [],
    selectedGroupId: null,
    selectedOrganizationSlug: 'acme-dev',
    showOrganizationSelector: false,
    ...overrides,
  };
}

function createRolesPageResult(overrides: Partial<BrowserRolesPageResult> = {}): BrowserRolesPageResult {
  return {
    currentOrganizationPermissions: ['organization.role.manage'],
    mode: 'list',
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [createOrganizationOption()],
    permissionKeys: ['project.read'],
    principalEmail: 'admin@example.com',
    role: null,
    roleId: null,
    roles: [],
    selectedOrganizationSlug: 'acme-dev',
    showOrganizationSelector: false,
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
