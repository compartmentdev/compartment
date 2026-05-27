import {
  accessAssignmentScopeOptionsResponseSchema,
  accessGroupListOptionsResponseSchema,
  accessGroupListResponseSchema,
  accessRoleListOptionsResponseSchema,
  accessRoleListResponseSchema,
  compartmentAssignmentScopeOptionsPathname,
  compartmentGroupsPathname,
  compartmentRolesPathname,
  userAccessDetailResponseSchema,
  userListResponseSchema,
  type AccessAssignmentScopeOptionsResponse,
  type AccessGroupListOptionsResponse,
  type AccessGroupListResponse,
  type AccessRoleListOptionsResponse,
  type AccessRoleListResponse,
  type PermissionKey,
  type UserAccessDetailResponse,
  type UserListResponse,
} from '@compartment/contracts/browser';
import type {
  BrowserUsersPageSize,
  BrowserUsersSortBy,
  BrowserUsersSortDirection,
} from '../../services/browser-users.service.types';
import { buildUserAccessApiPath, usersApiPathname } from '../../routes/users/users-api-paths';
import { requestBrowserApi, type BrowserApiRequestOptions } from '../../lib/browser-api';
import {
  readBrowserTablePageSize,
  readPositiveIntegerSearchParam,
  readTrimmedSearchParam,
} from '../../lib/server-table-query';
import {
  readBrowserErrorMessage,
  readBrowserNoticeMessage,
  writeBrowserConsoleListSearchParams,
} from '../console/console-data';
import { canReadBrowserGroups, canReadBrowserRoles } from '../console/console-access';
import { resolveSelectedConsoleUserEmail } from './users-loader.selected-user';

export interface UsersLoaderQuery {
  errorMessage?: string | undefined;
  mode: 'create' | 'detail' | 'list';
  noticeMessage?: string | undefined;
  page: number;
  pageSize: BrowserUsersPageSize;
  searchQuery: string;
  selectedUserEmail: string | null;
  sortBy: BrowserUsersSortBy;
  sortDirection: BrowserUsersSortDirection;
}

export interface UsersPageResponses {
  access: UserAccessDetailResponse | null;
  groups: AccessGroupListResponse;
  roles: AccessRoleListResponse;
  selectedUserEmail: string | null;
  scopeOptions: AccessAssignmentScopeOptionsResponse;
  users: UserListResponse;
}

interface UsersPageListResponses {
  groups: AccessGroupListResponse;
  roles: AccessRoleListResponse;
  scopeOptions: AccessAssignmentScopeOptionsResponse;
  users: UserListResponse;
}

const emptyRolesPageResponse: AccessRoleListResponse = { roles: [] };
const emptyGroupsPageResponse: AccessGroupListResponse = { groups: [] };
const emptyScopeOptionsResponse: AccessAssignmentScopeOptionsResponse = { projects: [] };

export function readUsersLoaderQuery(searchParams: URLSearchParams): UsersLoaderQuery {
  return {
    errorMessage: readBrowserErrorMessage(searchParams.get('error')),
    mode: readUsersMode(searchParams),
    noticeMessage: readBrowserNoticeMessage(searchParams.get('notice')),
    page: readPositiveIntegerSearchParam(searchParams.get('page'), 1),
    pageSize: readBrowserTablePageSize(searchParams.get('pageSize') ?? ''),
    searchQuery: readTrimmedSearchParam(searchParams, 'q'),
    selectedUserEmail: readSelectedUserEmail(searchParams),
    sortBy: readSortBy(searchParams.get('sortBy')),
    sortDirection: readSortDirection(searchParams.get('sortDirection')),
  };
}

export async function loadUsersPageResponses(
  query: UsersLoaderQuery,
  permissions: PermissionKey[],
  organizationSlug: string,
  options: BrowserApiRequestOptions = {},
): Promise<UsersPageResponses> {
  const listResponses: UsersPageListResponses = await loadUsersPageListResponses(
    query,
    permissions,
    organizationSlug,
    options,
  );
  const selectedUserEmail: string | null = await resolveSelectedConsoleUserEmail(
    query,
    listResponses.users.users,
    organizationSlug,
    options,
  );
  const access: UserAccessDetailResponse | null = await readSelectedUserAccess(
    selectedUserEmail,
    organizationSlug,
    options,
  );

  return { ...listResponses, access, selectedUserEmail };
}

async function loadUsersPageListResponses(
  query: UsersLoaderQuery,
  permissions: PermissionKey[],
  organizationSlug: string,
  options: BrowserApiRequestOptions,
): Promise<UsersPageListResponses> {
  const [users, roles, groups, scopeOptions]: [
    UserListResponse,
    AccessRoleListResponse,
    AccessGroupListResponse,
    AccessAssignmentScopeOptionsResponse,
  ] = await Promise.all([
    fetchUsersPageResponse(query, organizationSlug, options),
    readRolesPageResponse(permissions, organizationSlug, options),
    readGroupsPageResponse(permissions, organizationSlug, options),
    readScopeOptionsResponse(permissions, organizationSlug, options),
  ]);

  return { groups, roles, scopeOptions, users };
}

async function readRolesPageResponse(
  permissions: PermissionKey[],
  organizationSlug: string,
  options: BrowserApiRequestOptions,
): Promise<AccessRoleListResponse> {
  return canReadBrowserRoles(permissions)
    ? await fetchRolesPageResponse(organizationSlug, options)
    : emptyRolesPageResponse;
}

async function readGroupsPageResponse(
  permissions: PermissionKey[],
  organizationSlug: string,
  options: BrowserApiRequestOptions,
): Promise<AccessGroupListResponse> {
  return canReadBrowserGroups(permissions)
    ? await fetchGroupsPageResponse(organizationSlug, options)
    : emptyGroupsPageResponse;
}

async function readScopeOptionsResponse(
  permissions: PermissionKey[],
  organizationSlug: string,
  options: BrowserApiRequestOptions,
): Promise<AccessAssignmentScopeOptionsResponse> {
  return canReadBrowserRoles(permissions)
    ? await fetchScopeOptionsResponse(organizationSlug, options)
    : emptyScopeOptionsResponse;
}

function readSortBy(value: string | null): BrowserUsersSortBy {
  return value === 'status' ? value : 'email';
}

function readSortDirection(value: string | null): BrowserUsersSortDirection {
  return value === 'desc' ? 'desc' : 'asc';
}

export async function fetchUsersPageResponse(
  query: UsersLoaderQuery,
  organizationSlug: string,
  options: BrowserApiRequestOptions = {},
): Promise<UserListResponse> {
  return await requestBrowserApi<UserListResponse>(buildUserListPath(query), userListResponseSchema, {
    currentOrganization: organizationSlug,
    signal: options.signal,
  });
}

export async function fetchRolesPageResponse(
  organizationSlug: string,
  options: BrowserApiRequestOptions = {},
): Promise<AccessRoleListResponse> {
  const response: AccessRoleListOptionsResponse = await requestBrowserApi(
    `${compartmentRolesPathname}?detail=options`,
    accessRoleListOptionsResponseSchema,
    {
      currentOrganization: organizationSlug,
      signal: options.signal,
    },
  );

  return accessRoleListResponseSchema.parse({ roles: response.roles });
}

export async function fetchGroupsPageResponse(
  organizationSlug: string,
  options: BrowserApiRequestOptions = {},
): Promise<AccessGroupListResponse> {
  const response: AccessGroupListOptionsResponse = await requestBrowserApi(
    `${compartmentGroupsPathname}?detail=options`,
    accessGroupListOptionsResponseSchema,
    {
      currentOrganization: organizationSlug,
      signal: options.signal,
    },
  );

  return accessGroupListResponseSchema.parse({ groups: response.groups });
}

export async function fetchScopeOptionsResponse(
  organizationSlug: string,
  options: BrowserApiRequestOptions = {},
): Promise<AccessAssignmentScopeOptionsResponse> {
  return await requestBrowserApi<AccessAssignmentScopeOptionsResponse>(
    compartmentAssignmentScopeOptionsPathname,
    accessAssignmentScopeOptionsResponseSchema,
    { currentOrganization: organizationSlug, signal: options.signal },
  );
}

function buildUserListPath(query: UsersLoaderQuery): string {
  const searchParams: URLSearchParams = new URLSearchParams();
  searchParams.set('orderBy', query.sortBy);
  searchParams.set('type', 'user');
  writeBrowserConsoleListSearchParams(searchParams, query);

  return `${usersApiPathname}?${searchParams.toString()}`;
}

async function readSelectedUserAccess(
  selectedUserEmail: string | null,
  organizationSlug: string,
  options: BrowserApiRequestOptions,
): Promise<UserAccessDetailResponse | null> {
  if (selectedUserEmail === null) {
    return null;
  }

  return await fetchUserAccessResponse(selectedUserEmail, organizationSlug, options);
}

export async function fetchUserAccessResponse(
  email: string,
  organizationSlug: string,
  options: BrowserApiRequestOptions = {},
): Promise<UserAccessDetailResponse> {
  return await requestBrowserApi<UserAccessDetailResponse>(
    buildUserAccessApiPath(email),
    userAccessDetailResponseSchema,
    {
      currentOrganization: organizationSlug,
      signal: options.signal,
    },
  );
}

function readUsersMode(searchParams: URLSearchParams): 'create' | 'detail' | 'list' {
  if (searchParams.get('mode') === 'create') {
    return 'create';
  }
  if (readSelectedUserEmail(searchParams) !== null) {
    return 'detail';
  }

  return 'list';
}

function readSelectedUserEmail(searchParams: URLSearchParams): string | null {
  const email: string = readTrimmedSearchParam(searchParams, 'userEmail');
  return email === '' ? null : email;
}
