import type { QueryKey } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { BrowserRolesPageResult } from '../../services/browser-roles.service.types';
import {
  readAccessOrganizationUnavailableQueryKey,
  readAccessRolesDetailQueryKey,
  readAccessRolesListQueryKey,
} from '../access/access-query';
import type { RolesLoaderQuery } from './roles-loader';
import type { RolesPageQueryData, RolesPageQueryKeys } from './roles-query-state.types';

export function useRolesPageQueryKeys(
  organizationSlug: string | null,
  query: RolesLoaderQuery,
  roleId: string | null,
): RolesPageQueryKeys {
  return useMemo(
    (): RolesPageQueryKeys => readRolesPageQueryKeys(organizationSlug, query, roleId),
    [organizationSlug, query, roleId],
  );
}

export function useInitialRolesPageQueryData(loaderData: BrowserRolesPageResult): RolesPageQueryData {
  return useMemo(
    (): RolesPageQueryData => readInitialRolesPageQueryData(loaderData),
    [
      loaderData.page,
      loaderData.pageSize,
      loaderData.role,
      loaderData.roles,
      loaderData.totalPages,
      loaderData.totalRoles,
    ],
  );
}

function readRolesPageQueryKeys(
  organizationSlug: string | null,
  query: RolesLoaderQuery,
  roleId: string | null,
): RolesPageQueryKeys {
  if (organizationSlug === null) {
    return readRolesPageOrganizationUnavailableQueryKeys(query, roleId);
  }

  return {
    role: readRolesDetailQueryKey(organizationSlug, roleId),
    roles: readAccessRolesListQueryKey(
      organizationSlug,
      query.page,
      query.pageSize,
      query.searchQuery,
      query.sortBy,
      query.sortDirection,
    ),
  };
}

function readRolesDetailQueryKey(organizationSlug: string, roleId: string | null): QueryKey {
  return roleId === null
    ? ['console-access', 'roles', organizationSlug, 'detail', 'unselected']
    : readAccessRolesDetailQueryKey(organizationSlug, roleId);
}

function readRolesPageOrganizationUnavailableQueryKeys(
  query: RolesLoaderQuery,
  roleId: string | null,
): RolesPageQueryKeys {
  return {
    role: readAccessOrganizationUnavailableQueryKey('roles', 'detail', roleId ?? 'unselected'),
    roles: readAccessOrganizationUnavailableQueryKey(
      'roles',
      'list',
      String(query.page),
      String(query.pageSize),
      query.searchQuery,
      query.sortBy,
      query.sortDirection,
    ),
  };
}

function readInitialRolesPageQueryData(data: BrowserRolesPageResult): RolesPageQueryData {
  return {
    role: data.role === null ? undefined : { role: data.role },
    roles: {
      detail: 'list',
      pagination: {
        page: data.page,
        perPage: data.pageSize,
        totalItems: data.totalRoles,
        totalPages: data.totalPages,
      },
      roles: data.roles,
    },
  };
}
