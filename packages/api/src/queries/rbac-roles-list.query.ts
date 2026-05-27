import { hasText } from '@compartment/utils';
import type { AccessRoleListOrderBy, ListSortDirection } from '@compartment/contracts';
import { and, asc, count, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import type { SelectedFields } from 'drizzle-orm/pg-core/query-builders/select.types';
import { accessAssignments, accessRolePermissions, accessRoles } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type { AccessRoleListPageRecord, ListAccessRolesPageInput } from './rbac-roles-list.query.types';
import type { AccessRoleKindValue } from './rbac.query.types';

interface AccessRolePageRecordSelection extends SelectedFields {
  assignmentCount: SQL<number>;
  description: typeof accessRoles.description;
  groupCount: SQL<number>;
  id: typeof accessRoles.id;
  kind: typeof accessRoles.kind;
  name: typeof accessRoles.name;
  principalCount: SQL<number>;
}

interface AccessRolePageRecordRow extends Omit<AccessRoleListPageRecord, 'kind'> {
  kind: string;
}

export async function countAccessRoleRecords(organizationId: string, search: string | undefined): Promise<number> {
  const rows: { value: number }[] = await getApiDatabase()
    .select({ value: count() })
    .from(accessRoles)
    .where(buildAccessRolePageFilter(organizationId, search));

  return rows[0]?.value ?? 0;
}

export async function listAccessRolePageRecords(input: ListAccessRolesPageInput): Promise<AccessRoleListPageRecord[]> {
  const rows: AccessRolePageRecordRow[] = await getApiDatabase()
    .select(readAccessRolePageRecordSelection())
    .from(accessRoles)
    .leftJoin(accessAssignments, eq(accessAssignments.roleId, accessRoles.id))
    .where(buildAccessRolePageFilter(input.organizationId, input.search))
    .groupBy(accessRoles.id)
    .orderBy(...buildAccessRolePageOrderBy(input.orderBy, input.sort))
    .limit(input.perPage)
    .offset((input.page - 1) * input.perPage);

  return rows.map(
    (row: AccessRolePageRecordRow): AccessRoleListPageRecord => ({
      ...row,
      kind: row.kind as AccessRoleKindValue,
    }),
  );
}

function readAccessRolePageRecordSelection(): AccessRolePageRecordSelection {
  return {
    assignmentCount: count(sql`distinct ${accessAssignments.id}`),
    description: accessRoles.description,
    groupCount: count(
      sql`distinct case when ${accessAssignments.subjectType} = 'group' then ${accessAssignments.subjectId} end`,
    ),
    id: accessRoles.id,
    kind: accessRoles.kind,
    name: accessRoles.name,
    principalCount: count(
      sql`distinct case when ${accessAssignments.subjectType} = 'principal' then ${accessAssignments.subjectId} end`,
    ),
  };
}

function buildAccessRolePageFilter(organizationId: string, search: string | undefined): SQL {
  const searchFilter: SQL | undefined = buildAccessRoleSearchFilter(search);

  return searchFilter === undefined
    ? eq(accessRoles.organizationId, organizationId)
    : and(eq(accessRoles.organizationId, organizationId), searchFilter)!;
}

function buildAccessRoleSearchFilter(search: string | undefined): SQL | undefined {
  if (!hasText(search)) {
    return undefined;
  }

  const searchPattern: string = buildRbacSearchPattern(search);

  return or(
    sql`
      lower(concat_ws(' ', ${accessRoles.name}, ${accessRoles.kind}, coalesce(${accessRoles.description}, '')))
      like ${searchPattern}
      escape '\\'
    `,
    sql`exists (
      select 1
      from ${accessRolePermissions}
      where ${accessRolePermissions.roleId} = ${accessRoles.id}
        and lower(${accessRolePermissions.permissionKey}) like ${searchPattern}
        escape '\\'
    )`,
  )!;
}

function buildAccessRolePageOrderBy(orderBy: AccessRoleListOrderBy, sort: ListSortDirection): SQL[] {
  const direction: typeof asc | typeof desc = sort === 'asc' ? asc : desc;

  switch (orderBy) {
    case 'assignmentCount':
      return [
        direction(count(sql`distinct ${accessAssignments.id}`)),
        asc(buildAccessRoleNameSortExpression()),
        asc(accessRoles.name),
      ];
    case 'kind':
      return [direction(accessRoles.kind), asc(buildAccessRoleNameSortExpression()), asc(accessRoles.name)];
    case 'name':
      return [direction(buildAccessRoleNameSortExpression()), direction(accessRoles.name)];
  }
}

function buildAccessRoleNameSortExpression(): SQL<string> {
  return sql<string>`lower(${accessRoles.name})`;
}

function buildRbacSearchPattern(search: string): string {
  const normalizedSearch: string = search.trim().toLowerCase();
  const escapedSearch: string = normalizedSearch.replace(/([\\%_])/gu, '\\$1');

  return `%${escapedSearch}%`;
}
