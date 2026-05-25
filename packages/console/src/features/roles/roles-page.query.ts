import type { AccessRoleListRow } from '@compartment/contracts/browser';
import {
  browserGroupsPathname,
  browserRolesPathname,
  browserUsersPathname,
  buildBrowserOrganizationScopedPathname,
} from '../../browser-public-paths';

export interface RolesBackLink {
  href: string;
  label: string;
}

interface RolesHrefInput {
  backHref?: string | undefined;
  mode?: 'create' | 'detail' | 'edit' | 'list';
  organizationSlug: string | null;
  roleId?: string | null;
}

interface RolesPageHrefContext {
  backHref?: string | undefined;
  selectedOrganizationSlug: string | null;
}

const browserConsoleOrigin: string = 'http://console.localhost';
const rolesReturnToSearchParamName: string = 'returnTo';

export function buildRolesPageHref(
  context: RolesPageHrefContext,
  input: Omit<RolesHrefInput, 'organizationSlug'> = {},
): string {
  return buildRolesHref({ ...input, backHref: context.backHref, organizationSlug: context.selectedOrganizationSlug });
}

export function buildRolesOrganizationHref(
  selectedOrganizationSlug: string,
  input: Omit<RolesHrefInput, 'organizationSlug'> = {},
): string {
  return buildRolesHref({
    ...input,
    organizationSlug: selectedOrganizationSlug,
  });
}

export function buildRolesHref(input: RolesHrefInput): string {
  const searchParams: URLSearchParams = new URLSearchParams();
  if (input.mode !== undefined && input.mode !== 'list') {
    searchParams.set('mode', input.mode);
  }
  if (input.roleId !== null && input.roleId !== undefined) {
    searchParams.set('roleId', input.roleId);
  }
  appendRolesBackHref(searchParams, input.backHref);

  const query: string = searchParams.toString();
  const pathname: string =
    input.organizationSlug === null
      ? browserRolesPathname
      : buildBrowserOrganizationScopedPathname(input.organizationSlug, browserRolesPathname);
  return query === '' ? pathname : `${pathname}?${query}`;
}

export function readRoleSearchText(role: AccessRoleListRow): string {
  return [role.name, role.kind, role.description ?? '', ...role.permissionKeys].join(' ').toLowerCase();
}

export function readRolesBackHref(
  searchParams: URLSearchParams,
  selectedOrganizationSlug: string | null,
): string | undefined {
  return readRolesBackLink(searchParams.get(rolesReturnToSearchParamName) ?? undefined, selectedOrganizationSlug)?.href;
}

export function readRolesBackLink(
  backHref: string | undefined,
  selectedOrganizationSlug: string | null,
): RolesBackLink | null {
  if (backHref === undefined || backHref === '' || selectedOrganizationSlug === null) {
    return null;
  }

  const url: URL | null = readRolesRelativeUrl(backHref);
  if (url === null) {
    return null;
  }

  const label: string | null = readRolesBackLabel(url.pathname, selectedOrganizationSlug);
  if (label === null) {
    return null;
  }

  return {
    href: `${url.pathname}${url.search}`,
    label,
  };
}

function appendRolesBackHref(searchParams: URLSearchParams, backHref: string | undefined): void {
  if (backHref === undefined || backHref === '') {
    return;
  }

  searchParams.set(rolesReturnToSearchParamName, backHref);
}

function readRolesBackLabel(pathname: string, selectedOrganizationSlug: string): string | null {
  if (pathname === buildBrowserOrganizationScopedPathname(selectedOrganizationSlug, browserUsersPathname)) {
    return 'Back to Users';
  }
  if (pathname === buildBrowserOrganizationScopedPathname(selectedOrganizationSlug, browserGroupsPathname)) {
    return 'Back to Groups';
  }

  return null;
}

function readRolesRelativeUrl(href: string): URL | null {
  try {
    const url: URL = new URL(href, browserConsoleOrigin);
    return url.origin === browserConsoleOrigin ? url : null;
  } catch {
    return null;
  }
}
