import { hasText } from '@compartment/utils';
import type { AccessGroupListOrderBy, ListSortDirection } from '@compartment/contracts';
import { and, asc, count, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import {
  accessAssignments,
  accessGroupMemberships,
  accessGroups,
  accessRoles,
  environments,
  projects,
} from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type { AccessGroupListPageRow, ListAccessGroupsPageInput } from './rbac-groups-list.query.types';
import { readAccessGroupAggregateSelection } from './rbac-groups.query.helpers';

export async function countAccessGroups(organizationId: string, search: string | undefined): Promise<number> {
  const rows: { value: number }[] = await getApiDatabase()
    .select({ value: count() })
    .from(accessGroups)
    .where(buildAccessGroupPageFilter(organizationId, search));

  return rows[0]?.value ?? 0;
}

export async function readAccessGroupPageRows(input: ListAccessGroupsPageInput): Promise<AccessGroupListPageRow[]> {
  const rows: AccessGroupListPageRow[] = await getApiDatabase()
    .select(readAccessGroupAggregateSelection())
    .from(accessGroups)
    .leftJoin(accessGroupMemberships, eq(accessGroupMemberships.groupId, accessGroups.id))
    .leftJoin(
      accessAssignments,
      and(eq(accessAssignments.subjectType, 'group'), eq(accessAssignments.subjectId, accessGroups.id)),
    )
    .where(buildAccessGroupPageFilter(input.organizationId, input.search))
    .groupBy(accessGroups.id)
    .orderBy(...buildAccessGroupPageOrderBy(input.orderBy, input.sort))
    .limit(input.perPage)
    .offset((input.page - 1) * input.perPage);

  return rows;
}

function buildAccessGroupPageFilter(organizationId: string, search: string | undefined): SQL {
  const searchFilter: SQL | undefined = buildAccessGroupSearchFilter(search);

  return searchFilter === undefined
    ? eq(accessGroups.organizationId, organizationId)
    : and(eq(accessGroups.organizationId, organizationId), searchFilter)!;
}

function buildAccessGroupSearchFilter(search: string | undefined): SQL | undefined {
  if (!hasText(search)) {
    return undefined;
  }

  const searchPattern: string = buildRbacSearchPattern(search);

  return or(
    buildAccessGroupSummarySearchFilter(searchPattern),
    buildAccessGroupAssignedRoleSearchFilter(searchPattern),
    buildAccessGroupOrganizationScopeSearchFilter(searchPattern),
    buildAccessGroupProjectScopeSearchFilter(searchPattern),
    buildAccessGroupEnvironmentScopeSearchFilter(searchPattern),
  )!;
}

function buildAccessGroupSummarySearchFilter(searchPattern: string): SQL {
  return sql`
    lower(concat_ws(' ', ${accessGroups.name}, coalesce(${accessGroups.description}, '')))
    like ${searchPattern}
    escape '\\'
  `;
}

function buildAccessGroupAssignedRoleSearchFilter(searchPattern: string): SQL {
  return sql`exists (
    select 1
    from ${accessAssignments}
    inner join ${accessRoles} on ${accessRoles.id} = ${accessAssignments.roleId}
    where ${accessAssignments.organizationId} = ${accessGroups.organizationId}
      and ${accessAssignments.subjectType} = 'group'
      and ${accessAssignments.subjectId} = ${accessGroups.id}
      and lower(${accessRoles.name}) like ${searchPattern}
      escape '\\'
  )`;
}

function buildAccessGroupOrganizationScopeSearchFilter(searchPattern: string): SQL {
  return sql`exists (
    select 1
    from ${accessAssignments}
    where ${accessAssignments.organizationId} = ${accessGroups.organizationId}
      and ${accessAssignments.subjectType} = 'group'
      and ${accessAssignments.subjectId} = ${accessGroups.id}
      and ${accessAssignments.scopeType} = 'organization'
      and lower('org-wide') like ${searchPattern}
      escape '\\'
  )`;
}

function buildAccessGroupProjectScopeSearchFilter(searchPattern: string): SQL {
  return sql`exists (
    select 1
    from ${accessAssignments}
    inner join ${projects} on ${projects.id} = ${accessAssignments.scopeId}
    where ${accessAssignments.organizationId} = ${accessGroups.organizationId}
      and ${accessAssignments.subjectType} = 'group'
      and ${accessAssignments.subjectId} = ${accessGroups.id}
      and ${accessAssignments.scopeType} = 'project'
      and lower(${projects.name}) like ${searchPattern}
      escape '\\'
  )`;
}

function buildAccessGroupEnvironmentScopeSearchFilter(searchPattern: string): SQL {
  return sql`exists (
    select 1
    from ${accessAssignments}
    inner join ${environments} on ${environments.id} = ${accessAssignments.scopeId}
    inner join ${projects} on ${projects.id} = ${environments.projectId}
    where ${accessAssignments.organizationId} = ${accessGroups.organizationId}
      and ${accessAssignments.subjectType} = 'group'
      and ${accessAssignments.subjectId} = ${accessGroups.id}
      and ${accessAssignments.scopeType} = 'environment'
      and lower(concat_ws(' ', ${projects.name}, ${environments.name}, ${projects.name} || ' / ' || ${environments.name}))
        like ${searchPattern}
        escape '\\'
  )`;
}

function buildAccessGroupPageOrderBy(orderBy: AccessGroupListOrderBy, sort: ListSortDirection): SQL[] {
  const direction: typeof asc | typeof desc = sort === 'asc' ? asc : desc;

  switch (orderBy) {
    case 'assignmentCount':
      return [
        direction(count(sql`distinct ${accessAssignments.id}`)),
        asc(buildAccessGroupNameSortExpression()),
        asc(accessGroups.name),
      ];
    case 'memberCount':
      return [
        direction(count(sql`distinct ${accessGroupMemberships.id}`)),
        asc(buildAccessGroupNameSortExpression()),
        asc(accessGroups.name),
      ];
    case 'name':
      return [direction(buildAccessGroupNameSortExpression()), direction(accessGroups.name)];
  }
}

function buildAccessGroupNameSortExpression(): SQL<string> {
  return sql<string>`lower(${accessGroups.name})`;
}

function buildRbacSearchPattern(search: string): string {
  const normalizedSearch: string = search.trim().toLowerCase();
  const escapedSearch: string = normalizedSearch.replace(/([\\%_])/gu, '\\$1');

  return `%${escapedSearch}%`;
}
