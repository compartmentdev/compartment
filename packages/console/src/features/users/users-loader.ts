import { redirect, type LoaderFunctionArgs } from 'react-router';
import type { PermissionKey } from '@compartment/contracts/browser';
import type { BrowserUsersPageResult } from '../../services/browser-users.service.types';
import { browserTablePageSizeOptions } from '../../services/browser-table.service.types';
import type { BrowserApiRequestOptions } from '../../lib/browser-api';
import { BrowserRedirect, readBrowserApiRedirect } from '../../lib/browser-redirect';
import { loadBrowserConsoleContext, type BrowserConsoleContext } from '../console/console-data';
import {
  buildUsersAdminRequiredRedirectTarget,
  canInviteBrowserUsers,
  canReadBrowserUsers,
} from '../console/console-access';
import {
  loadUsersPageResponses,
  readUsersLoaderQuery,
  type UsersLoaderQuery,
  type UsersPageResponses,
} from './users-loader.helpers';

type UsersPageSelection = Pick<
  BrowserUsersPageResult,
  | 'mode'
  | 'page'
  | 'pageSize'
  | 'pageSizeOptions'
  | 'principalEmail'
  | 'searchQuery'
  | 'selectedOrganizationSlug'
  | 'selectedUserAccess'
  | 'selectedUserEmail'
  | 'showOrganizationSelector'
  | 'sortBy'
  | 'sortDirection'
>;

type UsersLoaderAccessMode = 'invite' | 'none' | 'read';

export async function loadUsersPageData({ request }: LoaderFunctionArgs): Promise<BrowserUsersPageResult> {
  const url: URL = new URL(request.url);

  try {
    return await loadUsersPageDataForUrl(url, { signal: request.signal });
  } catch (error) {
    if (error instanceof BrowserRedirect) {
      return redirect(error.to) as never;
    }

    throw error;
  }
}

async function loadUsersPageDataForUrl(
  url: URL,
  options: BrowserApiRequestOptions = {},
): Promise<BrowserUsersPageResult> {
  const query: UsersLoaderQuery = readUsersLoaderQuery(url.searchParams);
  const context: BrowserConsoleContext = await loadBrowserConsoleContext(url, options);
  if (context.selectedOrganizationSlug === null) {
    return buildEmptyUsersPageResult(context, query);
  }

  return await loadSelectedOrganizationUsersPageData(context, query, context.selectedOrganizationSlug, options);
}

async function loadSelectedOrganizationUsersPageData(
  context: BrowserConsoleContext,
  query: UsersLoaderQuery,
  organizationSlug: string,
  options: BrowserApiRequestOptions,
): Promise<BrowserUsersPageResult> {
  const usersAdminRequiredRedirectTarget: string = buildUsersAdminRequiredRedirectTarget(organizationSlug);
  const accessMode: UsersLoaderAccessMode = readUsersLoaderAccessMode(context.currentOrganizationPermissions);
  if (accessMode === 'none') {
    throw new BrowserRedirect(usersAdminRequiredRedirectTarget);
  }
  if (accessMode === 'invite') {
    return loadInviteOnlyUsersPageDataForContext(context, query);
  }

  return await loadUsersPageDataForContext(
    context,
    readUsersLoaderAuthorizedQuery(query, context.currentOrganizationPermissions),
    organizationSlug,
    usersAdminRequiredRedirectTarget,
    options,
  );
}

function loadInviteOnlyUsersPageDataForContext(
  context: BrowserConsoleContext,
  query: UsersLoaderQuery,
): BrowserUsersPageResult {
  const inviteQuery: UsersLoaderQuery = { ...query, mode: 'create', selectedUserEmail: null };

  return {
    ...buildUsersPageBaseResult(context, inviteQuery),
    page: 1,
    totalPages: 1,
    totalUsers: 0,
    users: [],
  };
}

function readUsersLoaderAccessMode(permissions: PermissionKey[]): UsersLoaderAccessMode {
  if (canReadBrowserUsers(permissions)) {
    return 'read';
  }
  return canInviteBrowserUsers(permissions) ? 'invite' : 'none';
}

async function loadUsersPageDataForContext(
  context: BrowserConsoleContext,
  query: UsersLoaderQuery,
  organizationSlug: string,
  usersAdminRequiredRedirectTarget: string,
  options: BrowserApiRequestOptions,
): Promise<BrowserUsersPageResult> {
  try {
    return buildUsersPageResult(
      context,
      query,
      await loadUsersPageResponses(query, context.currentOrganizationPermissions, organizationSlug, options),
    );
  } catch (error) {
    if (error instanceof Error) {
      throw readBrowserApiRedirect(error, usersAdminRequiredRedirectTarget) ?? error;
    }

    throw error;
  }
}

function buildUsersPageResult(
  context: BrowserConsoleContext,
  query: UsersLoaderQuery,
  responses: UsersPageResponses,
): BrowserUsersPageResult {
  return {
    ...buildUsersPageBaseResult(context, query),
    availableGroups: responses.groups.groups,
    availableRoles: responses.roles.roles,
    page: responses.users.pagination.page,
    selectedUserAccess: responses.access?.access ?? null,
    scopeProjects: responses.scopeOptions.projects,
    totalPages: responses.users.pagination.totalPages,
    totalUsers: responses.users.pagination.totalItems,
    users: responses.users.users,
  };
}

function buildEmptyUsersPageResult(context: BrowserConsoleContext, query: UsersLoaderQuery): BrowserUsersPageResult {
  return {
    ...buildUsersPageBaseResult(context, query),
    availableGroups: [],
    availableRoles: [],
    page: 1,
    mode: query.mode,
    selectedOrganizationSlug: null,
    selectedUserAccess: null,
    showOrganizationSelector: context.showOrganizationSelector,
    scopeProjects: [],
    totalPages: 1,
    totalUsers: 0,
    users: [],
  };
}

function buildUsersPageBaseResult(context: BrowserConsoleContext, query: UsersLoaderQuery): BrowserUsersPageResult {
  return {
    availableGroups: [],
    availableRoles: [],
    currentOrganizationPermissions: context.currentOrganizationPermissions,
    errorMessage: query.errorMessage,
    noticeMessage: query.noticeMessage,
    organizationContext: context.organizationContext,
    organizations: context.organizations,
    ...readUsersPageSelection(query, context),
    scopeProjects: [],
    totalPages: query.page,
    totalUsers: 0,
    users: [],
  };
}

function readUsersPageSelection(query: UsersLoaderQuery, context: BrowserConsoleContext): UsersPageSelection {
  return {
    page: query.page,
    pageSize: query.pageSize,
    pageSizeOptions: browserTablePageSizeOptions,
    principalEmail: context.principalEmail,
    searchQuery: query.searchQuery,
    mode: query.mode,
    selectedOrganizationSlug: context.selectedOrganizationSlug,
    selectedUserAccess: null,
    selectedUserEmail: query.selectedUserEmail,
    showOrganizationSelector: context.showOrganizationSelector,
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
  };
}

function readUsersLoaderAuthorizedQuery(query: UsersLoaderQuery, permissions: PermissionKey[]): UsersLoaderQuery {
  if (query.mode !== 'create' || canInviteBrowserUsers(permissions)) {
    return query;
  }

  return { ...query, mode: 'list' };
}
