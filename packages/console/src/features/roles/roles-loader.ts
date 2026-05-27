import {
  accessRoleListPageResponseSchema,
  accessRoleResponseSchema,
  compartmentRolesPathname,
  listPermissionKeys,
  type AccessRoleListPageResponse,
  type AccessRoleResponse,
  type PermissionKey,
} from '@compartment/contracts/browser';
import { redirect, type LoaderFunctionArgs } from 'react-router';
import { BrowserApiError, requestBrowserApi, type BrowserApiRequestOptions } from '../../lib/browser-api';
import type { BrowserRolesPageResult } from '../../services/browser-roles.service.types';
import { browserTablePageSizeOptions } from '../../services/browser-table.service.types';
import { BrowserRedirect, readBrowserApiRedirect } from '../../lib/browser-redirect';
import {
  loadBrowserConsoleContext,
  loadSidebarProjectCount,
  readBrowserErrorMessage,
  readBrowserNoticeMessage,
  type BrowserConsoleContext,
} from '../console/console-data';
import { buildUsersAdminRequiredRedirectTarget, canReadBrowserRoles } from '../console/console-access';
import { buildBrowserAccessPageListPath } from '../access/access-list-path';
import { requireBrowserAccessSelectedOrganizationSlug } from '../access/access-query';
import { readRoleId, readRolesLoaderQuery, readRolesMode, type RolesLoaderQuery } from './roles-loader.query';
import { readRolesBackHref } from './roles-page.query';

export type { RolesLoaderQuery } from './roles-loader.query';

type BrowserRolesPageBaseResult = Omit<
  BrowserRolesPageResult,
  'page' | 'pageSize' | 'pageSizeOptions' | 'projectCount' | 'role' | 'roleId' | 'roles' | 'totalPages' | 'totalRoles'
>;

export async function loadRolesPageData({ request }: LoaderFunctionArgs): Promise<BrowserRolesPageResult> {
  const url: URL = new URL(request.url);

  try {
    return await loadRolesPageDataForUrl(url, { signal: request.signal });
  } catch (error) {
    if (error instanceof BrowserRedirect) {
      return redirect(error.to) as never;
    }

    throw error;
  }
}

async function loadRolesPageDataForUrl(
  url: URL,
  options: BrowserApiRequestOptions = {},
): Promise<BrowserRolesPageResult> {
  const query: RolesLoaderQuery = readRolesLoaderQuery(url.searchParams);
  const context: BrowserConsoleContext = await loadBrowserConsoleContext(url, options);
  if (context.selectedOrganizationSlug === null) {
    return buildEmptyRolesPageResult(context, query, url.searchParams);
  }
  const usersAdminRequiredRedirectTarget: string = buildUsersAdminRequiredRedirectTarget(
    context.selectedOrganizationSlug,
  );
  if (!canReadBrowserRoles(context.currentOrganizationPermissions)) {
    throw new BrowserRedirect(usersAdminRequiredRedirectTarget);
  }

  try {
    return await loadSelectedOrganizationRolesPageData(context, query, url.searchParams, options);
  } catch (error) {
    if (error instanceof Error) {
      throw readBrowserApiRedirect(error, usersAdminRequiredRedirectTarget) ?? error;
    }

    throw error;
  }
}

function buildEmptyRolesPageResult(
  context: BrowserConsoleContext,
  query: RolesLoaderQuery,
  searchParams: URLSearchParams,
): BrowserRolesPageResult {
  return {
    ...buildRolesPageBaseResult(context, query, searchParams, null),
    page: 1,
    pageSize: query.pageSize,
    pageSizeOptions: browserTablePageSizeOptions,
    projectCount: 0,
    role: null,
    roleId: null,
    roles: [],
    totalPages: 1,
    totalRoles: 0,
  };
}

async function loadSelectedOrganizationRolesPageData(
  context: BrowserConsoleContext,
  query: RolesLoaderQuery,
  searchParams: URLSearchParams,
  options: BrowserApiRequestOptions,
): Promise<BrowserRolesPageResult> {
  const currentOrganization: string = requireBrowserAccessSelectedOrganizationSlug(context.selectedOrganizationSlug);
  const [projectCount, response]: [number, AccessRoleListPageResponse] = await Promise.all([
    loadSidebarProjectCount(currentOrganization, options),
    fetchRolesResponse(currentOrganization, query, options),
  ]);
  const requestedRoleId: string | null = readRoleId(searchParams);
  const role: AccessRoleResponse | null = await readSelectedRole(currentOrganization, requestedRoleId, options);
  const roleId: string | null = role === null ? null : requestedRoleId;

  return buildRolesPageResult(context, query, searchParams, projectCount, response, roleId, role);
}

function buildRolesPageResult(
  context: BrowserConsoleContext,
  query: RolesLoaderQuery,
  searchParams: URLSearchParams,
  projectCount: number,
  response: AccessRoleListPageResponse,
  roleId: string | null,
  role: AccessRoleResponse | null,
): BrowserRolesPageResult {
  return {
    ...buildRolesPageBaseResult(context, query, searchParams, roleId),
    page: response.pagination.page,
    pageSize: query.pageSize,
    pageSizeOptions: browserTablePageSizeOptions,
    projectCount,
    role: role?.role ?? null,
    roleId,
    roles: response.roles,
    totalPages: response.pagination.totalPages,
    totalRoles: response.pagination.totalItems,
  };
}

function buildRolesPageBaseResult(
  context: BrowserConsoleContext,
  query: RolesLoaderQuery,
  searchParams: URLSearchParams,
  roleId: string | null,
): BrowserRolesPageBaseResult {
  return {
    backHref: readRolesBackHref(searchParams, context.selectedOrganizationSlug),
    currentOrganizationPermissions: context.currentOrganizationPermissions,
    errorMessage: readBrowserErrorMessage(searchParams.get('error')),
    mode: readRolesMode(searchParams, roleId, context.currentOrganizationPermissions),
    noticeMessage: readBrowserNoticeMessage(searchParams.get('notice')),
    organizationContext: context.organizationContext,
    organizations: context.organizations,
    permissionKeys: listGrantableRolePermissionKeys(context.currentOrganizationPermissions),
    principalEmail: context.principalEmail,
    searchQuery: query.searchQuery,
    selectedOrganizationSlug: context.selectedOrganizationSlug,
    showOrganizationSelector: context.showOrganizationSelector,
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
  };
}

function listGrantableRolePermissionKeys(currentOrganizationPermissions: PermissionKey[]): PermissionKey[] {
  const knownPermissionKeys: ReadonlySet<PermissionKey> = new Set(listPermissionKeys());
  return currentOrganizationPermissions.filter((permissionKey: PermissionKey): boolean =>
    knownPermissionKeys.has(permissionKey),
  );
}

export async function fetchRolesResponse(
  currentOrganization: string,
  query: RolesLoaderQuery,
  options: BrowserApiRequestOptions = {},
): Promise<AccessRoleListPageResponse> {
  return await requestBrowserApi(
    buildBrowserAccessPageListPath(compartmentRolesPathname, query),
    accessRoleListPageResponseSchema,
    {
      currentOrganization,
      signal: options.signal,
    },
  );
}

export async function readSelectedRole(
  currentOrganization: string,
  roleId: string | null,
  options: BrowserApiRequestOptions = {},
): Promise<AccessRoleResponse | null> {
  if (roleId === null) {
    return null;
  }

  try {
    return await requestBrowserApi(
      `${compartmentRolesPathname}/${encodeURIComponent(roleId)}`,
      accessRoleResponseSchema,
      {
        currentOrganization,
        signal: options.signal,
      },
    );
  } catch (error) {
    if (error instanceof BrowserApiError && error.status === 404) {
      return null;
    }

    throw error;
  }
}
