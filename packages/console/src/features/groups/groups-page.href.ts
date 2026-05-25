import { browserGroupsPathname, buildBrowserOrganizationScopedPathname } from '../../browser-public-paths';

type GroupsPageMode = 'create' | 'detail' | 'list';

interface GroupsPageHrefContext {
  selectedOrganizationSlug: string | null;
}

export function buildGroupsPageHref(
  context: GroupsPageHrefContext,
  groupId: string | null,
  mode?: GroupsPageMode,
): string {
  return buildGroupsHref(context.selectedOrganizationSlug, groupId, mode);
}

export function buildGroupsHref(
  organizationSlug: string | null,
  groupId: string | null,
  mode: GroupsPageMode = groupId === null ? 'list' : 'detail',
): string {
  const params: URLSearchParams = new URLSearchParams();
  if (groupId !== null) params.set('groupId', groupId);
  if (mode === 'create') params.set('mode', 'create');

  const query: string = params.toString();
  const pathname: string =
    organizationSlug === null
      ? browserGroupsPathname
      : buildBrowserOrganizationScopedPathname(organizationSlug, browserGroupsPathname);
  return query === '' ? pathname : `${pathname}?${query}`;
}
