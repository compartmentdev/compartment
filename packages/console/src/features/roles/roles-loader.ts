import {
  accessRoleListResponseSchema,
  accessRoleResponseSchema,
  compartmentRolesPathname,
  listPermissionKeys,
  type AccessRoleListResponse,
  type AccessRoleResponse,
  type PermissionKey,
} from '@compartment/contracts/browser';
import { redirect, type LoaderFunctionArgs } from 'react-router';
import type { BrowserRolesPageResult } from '../../services/browser-roles.service.types';
import { requestBrowserApi, type BrowserApiRequestOptions } from '../../lib/browser-api';
import { BrowserRedirect, readBrowserApiRedirect } from '../../lib/browser-redirect';
import {
  loadBrowserConsoleContext,
  readBrowserErrorMessage,
  readBrowserNoticeMessage,
  type BrowserConsoleContext,
} from '../console/console-data';
import {
  buildUsersAdminRequiredRedirectTarget,
  canManageBrowserRoles,
  canReadBrowserRoles,
} from '../console/console-access';
import { requireBrowserAccessSelectedOrganizationSlug } from '../access/access-query';
import { readRolesBackHref } from './roles-page.query';

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
  const context: BrowserConsoleContext = await loadBrowserConsoleContext(url, options);
  if (context.selectedOrganizationSlug === null) {
    return buildEmptyRolesPageResult(context, url.searchParams);
  }
  const usersAdminRequiredRedirectTarget: string = buildUsersAdminRequiredRedirectTarget(
    context.selectedOrganizationSlug,
  );
  if (!canReadBrowserRoles(context.currentOrganizationPermissions)) {
    throw new BrowserRedirect(usersAdminRequiredRedirectTarget);
  }

  try {
    return await loadSelectedOrganizationRolesPageData(context, url.searchParams, options);
  } catch (error) {
    if (error instanceof Error) {
      throw readBrowserApiRedirect(error, usersAdminRequiredRedirectTarget) ?? error;
    }

    throw error;
  }
}

function buildEmptyRolesPageResult(
  context: BrowserConsoleContext,
  searchParams: URLSearchParams,
): BrowserRolesPageResult {
  return {
    backHref: undefined,
    currentOrganizationPermissions: context.currentOrganizationPermissions,
    errorMessage: readBrowserErrorMessage(searchParams.get('error')),
    mode: 'list',
    noticeMessage: readBrowserNoticeMessage(searchParams.get('notice')),
    organizationContext: context.organizationContext,
    organizations: context.organizations,
    permissionKeys: listGrantableRolePermissionKeys(context.currentOrganizationPermissions),
    principalEmail: context.principalEmail,
    role: null,
    roleId: null,
    roles: [],
    selectedOrganizationSlug: null,
    showOrganizationSelector: context.showOrganizationSelector,
  };
}

async function loadSelectedOrganizationRolesPageData(
  context: BrowserConsoleContext,
  searchParams: URLSearchParams,
  options: BrowserApiRequestOptions,
): Promise<BrowserRolesPageResult> {
  const currentOrganization: string = requireBrowserAccessSelectedOrganizationSlug(context.selectedOrganizationSlug);
  const response: AccessRoleListResponse = await fetchRolesResponse(currentOrganization, options);
  const roleId: string | null = readRoleId(searchParams, response);

  return buildRolesPageResult(
    context,
    searchParams,
    response,
    roleId,
    await readSelectedRole(currentOrganization, roleId, options),
  );
}

function buildRolesPageResult(
  context: BrowserConsoleContext,
  searchParams: URLSearchParams,
  response: AccessRoleListResponse,
  roleId: string | null,
  role: AccessRoleResponse | null,
): BrowserRolesPageResult {
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
    role: role?.role ?? null,
    roleId,
    roles: response.roles,
    selectedOrganizationSlug: context.selectedOrganizationSlug,
    showOrganizationSelector: context.showOrganizationSelector,
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
  options: BrowserApiRequestOptions = {},
): Promise<AccessRoleListResponse> {
  return await requestBrowserApi(compartmentRolesPathname, accessRoleListResponseSchema, {
    currentOrganization,
    signal: options.signal,
  });
}

function readRoleId(searchParams: URLSearchParams, response: AccessRoleListResponse): string | null {
  const roleId: string | null = searchParams.get('roleId');
  if (roleId === null) {
    return null;
  }

  return response.roles.some((role: { id: string }): boolean => role.id === roleId) ? roleId : null;
}

function readRolesMode(
  searchParams: URLSearchParams,
  roleId: string | null,
  permissions: PermissionKey[],
): 'create' | 'detail' | 'edit' | 'list' {
  const mode: string | null = searchParams.get('mode');
  if (mode === 'create' && canManageBrowserRoles(permissions)) {
    return 'create';
  }
  if (mode === 'edit' && roleId !== null && canManageBrowserRoles(permissions)) {
    return 'edit';
  }
  if (roleId !== null) {
    return 'detail';
  }

  return 'list';
}

export async function readSelectedRole(
  currentOrganization: string,
  roleId: string | null,
  options: BrowserApiRequestOptions = {},
): Promise<AccessRoleResponse | null> {
  if (roleId === null) {
    return null;
  }

  return await requestBrowserApi(
    `${compartmentRolesPathname}/${encodeURIComponent(roleId)}`,
    accessRoleResponseSchema,
    {
      currentOrganization,
      signal: options.signal,
    },
  );
}
